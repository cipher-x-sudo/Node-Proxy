const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

const PORT = process.env.PORT || 3002;
const MAX_RETRIES = 10;
const BROWSER_TIMEOUT = 60000;
const NAVIGATION_TIMEOUT = 120000;
const RETRY_DELAY = 10000;

const app = express();

const sessionPages = new Map();
function getSessionId(req) {
    return (req.query && req.query.sid) || req.headers['x-session-id'] || (req.cookies && req.cookies.sid) || Math.random().toString(36).substring(2);
}

function debugLog(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    if (data) {
        if (data instanceof Error) {
            console.log('Error details:', {
                message: data.message,
                stack: data.stack,
                name: data.name
            });
        } else {
            console.log('Data:', JSON.stringify(data, null, 2));
        }
    }
}

let browser = null;

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initBrowser(retryCount = 0) {
    try {
        if (!browser) {
            debugLog(`Initializing new browser instance (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-zygote',
                    '--disable-audio-output',
                    '--disable-features=AudioServiceOutOfProcess',
                    '--use-fake-ui-for-media-stream',
                    '--use-fake-device-for-media-stream',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--window-size=1280,720'
                ],
                ignoreHTTPSErrors: true,
                timeout: BROWSER_TIMEOUT
            });
            debugLog('Browser instance created successfully');
        }
        return browser;
    } catch (error) {
        debugLog(`Error initializing browser (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
        if (retryCount < MAX_RETRIES - 1) {
            debugLog(`Retrying in ${RETRY_DELAY/1000} seconds...`);
            await wait(RETRY_DELAY);
            return initBrowser(retryCount + 1);
        }
        throw new Error(`Failed to initialize browser after ${MAX_RETRIES} attempts: ${error.message}`);
    }
}

function isStaticAsset(path) {
    return /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|otf|webp|mp4|webm|ogg|mp3|wav|m4a|json|xml|txt|map)(\?.*)?$/i.test(path);
}

function isHtmlRequest(req) {
    const accept = req.headers['accept'] || '';
    return accept.includes('text/html') || /\.html(\?.*)?$/i.test(req.path) || (!isStaticAsset(req.path) && !/\.[a-z0-9]+$/i.test(req.path));
}

function getTargetUrl(req) {
    return `https://app.leonardo.ai${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: '*', credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));

app.all('*', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    debugLog(`[${requestId}] New request received`, {
        method: req.method,
        path: req.path
    });

    if (!isHtmlRequest(req)) {
        const assetUrl = getTargetUrl(req);
        debugLog(`[${requestId}] Proxying non-HTML request`, {
            incomingUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
            targetUrl: assetUrl
        });
        try {
            const filteredHeaders = { ...req.headers };
            delete filteredHeaders['host'];
            delete filteredHeaders['connection'];
            delete filteredHeaders['content-length'];
            delete filteredHeaders['accept-encoding'];
            const fetchOptions = {
                method: req.method,
                headers: filteredHeaders,
                redirect: 'follow',
            };
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                fetchOptions.body = req;
            }
            const assetRes = await fetch(assetUrl, fetchOptions);
            assetRes.headers.forEach((value, key) => {
                if (!['content-encoding', 'content-length'].includes(key.toLowerCase())) {
                    res.setHeader(key, value);
                }
            });
            res.status(assetRes.status);
            assetRes.body.pipe(res);
            return;
        } catch (error) {
            debugLog(`[${requestId}] Error proxying non-HTML request:`, error);
            res.status(502).send('Error fetching resource');
            return;
        }
    }

    // HTML requests: use session-based Puppeteer pages
    const sid = getSessionId(req);
    let page = sessionPages.get(sid);
    let isNewPage = false;
    let requestInterceptor = null;
    let isInterceptionEnabled = false;

    try {
        const targetUrl = getTargetUrl(req);
        debugLog(`[${requestId}] Target URL constructed`, { targetUrl, sid });
        const browser = await initBrowser();
        if (!page) {
            debugLog(`[${requestId}] Creating new page for session ${sid}`);
            page = await browser.newPage();
            sessionPages.set(sid, page);
            isNewPage = true;
        } else {
            debugLog(`[${requestId}] Reusing existing page for session ${sid}`);
        }
        if (isNewPage) {
            debugLog(`[${requestId}] Configuring page settings`);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1'
            });
            try {
                await page.setRequestInterception(true);
                isInterceptionEnabled = true;
                requestInterceptor = page.on('request', async request => {
                    if (!isInterceptionEnabled) {
                        return;
                    }
                    try {
                        await request.continue();
                    } catch (error) {
                        if (isInterceptionEnabled) {
                            debugLog(`[${requestId}] Error continuing request:`, error);
                        }
                    }
                });
            } catch (error) {
                debugLog(`[${requestId}] Failed to set up request interception:`, error);
                requestInterceptor = null;
            }
            page.on('console', msg => {
                debugLog(`[${requestId}] Console ${msg.type()}:`, msg.text());
            });
        }
        debugLog(`[${requestId}] Navigating to target URL`);
        let response;
        try {
            const navigationPromise = page.goto(targetUrl, {
                waitUntil: 'networkidle2',
                timeout: NAVIGATION_TIMEOUT
            });
            await navigationPromise;
            const cookies = await page.cookies();
            debugLog(`[${requestId}] Page cookies after navigation:`, cookies);
            debugLog(`[${requestId}] Getting final HTML content`);
            let finalHtml = await page.content();
            debugLog(`[${requestId}] Setting response headers`);
            res.set('Content-Type', 'text/html');
            debugLog(`[${requestId}] Sending final HTML response`);
            res.status(200).send(finalHtml);
            debugLog(`[${requestId}] Full page load completed`);
        } catch (error) {
            debugLog(`[${requestId}] Navigation failed, but initial HTML was sent:`, error);
        }
    } catch (error) {
        debugLog(`[${requestId}] Error processing request:`, error);
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error');
        }
    } finally {
        // Clean up request interception if new page
        if (isNewPage && requestInterceptor && isInterceptionEnabled) {
            try {
                debugLog(`[${requestId}] Cleaning up request interception`);
                isInterceptionEnabled = false;
                requestInterceptor.removeAllListeners();
                await page.setRequestInterception(false);
            } catch (error) {
                debugLog(`[${requestId}] Error cleaning up request interception:`, error);
            }
        }
        // Do NOT close the page here; it will be closed on server shutdown or explicit session close
    }
});

async function startServer() {
    try {
        debugLog('Starting server initialization');
        try {
            await initBrowser();
        } catch (error) {
            debugLog('Critical error: Failed to initialize browser after all retries', error);
            process.exit(1);
        }
        app.listen(PORT, () => {
            debugLog(`Server started successfully on port ${PORT}`);
        });
    } catch (error) {
        debugLog('Error starting server:', error);
        process.exit(1);
    }
}

// On shutdown, close all pages
process.on('SIGINT', async () => {
    debugLog('Received shutdown signal');
    for (const [sid, page] of sessionPages.entries()) {
        try {
            debugLog(`Closing page for session ${sid}`);
            await page.close();
        } catch (error) {
            debugLog(`Error closing page for session ${sid}:`, error);
        }
    }
    if (browser) {
        debugLog('Closing browser instance');
        await browser.close();
    }
    debugLog('Server shutting down');
    process.exit(0);
});

startServer(); 