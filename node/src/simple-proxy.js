const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const { rewriteHtmlUrls, rewriteOther } = require('./rewriter');
const path = require('path');
const glob = require('glob');

// Configuration constants
const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 10;
const BROWSER_TIMEOUT = 60000; // 60 seconds
const NAVIGATION_TIMEOUT = 120000; // 2 minutes
const RETRY_DELAY = 10000; // 10 seconds

const app = express();

// Debug logging function
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

// Browser instance management
let browser = null;

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initBrowser(retryCount = 0) {
    try {
        if (!browser) {
            debugLog(`Initializing new browser instance (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            puppeteer.use(StealthPlugin());
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: '/home/ownera/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome',
                // dumpio: true,
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

// Load cookies from all cookies*.json files
let allCookies = [];

async function loadCookies() {
    try {
        debugLog('Loading cookies from all cookies*.json files');
        const files = glob.sync('cookies*.json', { cwd: process.cwd() });
        allCookies = [];
        for (const file of files) {
            const cookiesData = JSON.parse(await fs.readFile(path.join(process.cwd(), file), 'utf8'));
            allCookies.push(...cookiesData);
        }
        debugLog('Cookies loaded successfully', {
            files: files.length,
            totalCookies: allCookies.length
        });
    } catch (error) {
        debugLog('Error loading cookies:', error);
    }
}

// Helper to detect static assets
function isStaticAsset(path) {
    return /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|otf|webp|mp4|webm|ogg|mp3|wav|m4a|json|xml|txt|map)(\?.*)?$/i.test(path);
}

// Helper to detect HTML requests
function isHtmlRequest(req) {
    const accept = req.headers['accept'] || '';
    return accept.includes('text/html') || /\.html(\?.*)?$/i.test(req.path) || (!isStaticAsset(req.path) && !/\.[a-z0-9]+$/i.test(req.path));
}

// Helper to reconstruct the correct target URL for all requests
function getTargetUrlForAsset(req, config) {
    // Handle subdomain-style rewriting: /app-leonardo-ai/ -> app.leonardo.ai
    const subdomainPattern = /^\/([a-z0-9-]+)-leonardo-ai(\/.*)?$/i;
    const match = req.path.match(subdomainPattern);
    if (match) {
        const sub = match[1];
        const rest = match[2] || '/';
        return `https://${sub}.leonardo.ai${rest}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    }
    // Main domain
    return `https://${config.targetDomain}${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
}

// Session management for Puppeteer pages
const sessionPages = new Map();
function getSessionId(req) {
    return (req.query && req.query.sid) || req.headers['x-session-id'] || (req.cookies && req.cookies.sid) || Math.random().toString(36).substring(2);
}

// Endpoint to close a session/page
app.post('/close-session', async (req, res) => {
    const sid = req.query.sid || req.body.sid || req.headers['x-session-id'];
    if (!sid) {
        return res.status(400).json({ error: 'Missing session id' });
    }
    const page = sessionPages.get(sid);
    if (page) {
        try {
            await page.close();
            sessionPages.delete(sid);
            debugLog(`[close-session] Closed page for session ${sid}`);
            return res.json({ success: true });
        } catch (err) {
            debugLog(`[close-session] Error closing page for session ${sid}:`, err);
            return res.status(500).json({ error: 'Failed to close page' });
        }
    } else {
        return res.json({ success: false, message: 'No page for session' });
    }
});

// Proxy endpoint for third-party CORS
app.get('/proxy', async (req, res) => {
    const url = req.query.url;
    if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'Invalid or missing url parameter' });
    }
    try {
        const proxyRes = await fetch(url, { method: 'GET', headers: req.headers });
        proxyRes.headers.forEach((value, key) => {
            if (!['content-encoding', 'content-length'].includes(key.toLowerCase())) {
                res.setHeader(key, value);
            }
        });
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(proxyRes.status);
        proxyRes.body.pipe(res);
    } catch (err) {
        debugLog(`[proxy] Error proxying url: ${url}`, err);
        res.status(502).json({ error: 'Proxy fetch failed' });
    }
});

// Main proxy handler
app.all('*', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    debugLog(`[${requestId}] New request received`, {
        method: req.method,
        path: req.path
    });

    // Proxy all non-HTML requests directly
    if (!isHtmlRequest(req)) {
        const assetUrl = getTargetUrlForAsset(req, config);
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

    // HTML requests: use Puppeteer and rewrite with rewriter.js
    const sid = getSessionId(req);
    let page = sessionPages.get(sid);
    let isNewPage = false;
    let requestInterceptor = null;
    let isInterceptionEnabled = false;

    try {
        const targetUrl = getTargetUrlForAsset(req, config);
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
            debugLog(`[${requestId}] Setting cookies`);
            // Set all cookies matching the target domain or subdomain
            const urlObj = new URL(targetUrl);
            const domain = urlObj.hostname;
            const cookiesToSet = allCookies.filter(cookie => {
                // Set cookies for exact domain or parent domain
                return (
                    domain === cookie.domain.replace(/^\./, '') ||
                    domain.endsWith(cookie.domain.replace(/^\./, ''))
                );
            }).map(cookie => ({
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path || '/',
                expires: cookie.expirationDate,
                httpOnly: cookie.httpOnly,
                secure: cookie.secure,
                sameSite: cookie.sameSite
            }));
            if (cookiesToSet.length > 0) {
                await page.setCookie(...cookiesToSet);
            }
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
                waitUntil: 'domcontentloaded',
                timeout: NAVIGATION_TIMEOUT
            });
            await page.waitForFunction(() => {
                return document.readyState === 'interactive' || document.readyState === 'complete';
            }, { timeout: 5000 }).catch(() => {});
            debugLog(`[${requestId}] Getting initial HTML content`);
            let initialHtml = await page.content();
            if (/text\/html/i.test(await page.evaluate(() => document.contentType || 'text/html'))) {
                debugLog(`[${requestId}] Rewriting HTML URLs`);
                initialHtml = rewriteHtmlUrls(initialHtml, config.targetDomain, 'leonardo.anon404.me');
            }
            debugLog(`[${requestId}] Setting response headers`);
            res.set('Content-Type', 'text/html');
            debugLog(`[${requestId}] Sending initial HTML response`);
            res.status(200).send(initialHtml);
            response = await navigationPromise;
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
    }
});

// Start server
async function startServer() {
    try {
        debugLog('Starting server initialization');
        await loadCookies();
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

process.on('SIGINT', async () => {
    debugLog('Received shutdown signal');
    if (browser) {
        debugLog('Closing browser instance');
        await browser.close();
    }
    debugLog('Server shutting down');
    process.exit(0);
});

startServer();