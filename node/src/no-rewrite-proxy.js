const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const fetch = require('node-fetch');
const chalk = require('chalk');

puppeteer.use(StealthPlugin());

const PORT = process.env.PORT || 3001;
const MAX_RETRIES = 10;
const BROWSER_TIMEOUT = 60000;
const NAVIGATION_TIMEOUT = 120000;
const RETRY_DELAY = 10000;

const app = express();

const sessionPages = new Map();

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

function isStaticAsset(path) {
    return /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|otf|webp|mp4|webm|ogg|mp3|wav|m4a|json|xml|txt|map)(\?.*)?$/i.test(path);
}

function isHtmlRequest(req) {
    // Always treat /.well-known/vercel/security/* as non-HTML
    if (/^\/\.well-known\/vercel\/security\//.test(req.path)) {
        return false;
    }
    const accept = req.headers['accept'] || '';
    return accept.includes('text/html') || /\.html(\?.*)?$/i.test(req.path) || (!isStaticAsset(req.path) && !/\.[a-z0-9]+$/i.test(req.path));
}

function getSessionId(req) {
    return (req.query && req.query.sid) || req.headers['x-session-id'] || (req.cookies && req.cookies.sid) || Math.random().toString(36).substring(2);
}

function inferSubdomain(req, config, currentBrowserUrl) {
    // 1. If current browser URL is available, use its subdomain
    if (currentBrowserUrl && currentBrowserUrl !== '[none]' && currentBrowserUrl !== '[error retrieving URL]') {
        try {
            const url = new URL(currentBrowserUrl);
            const subMatch = url.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
            if (subMatch) {
                return subMatch[1];
            }
        } catch (e) {}
    }
    // 2. Path-based: /sub-leonardo-ai/...
    const subdomainPattern = /^\/([a-z0-9-]+)-leonardo-ai(\/.*)?$/i;
    const match = req.path.match(subdomainPattern);
    if (match) {
        return match[1];
    }
    // 3. Referer-based: https://<sub>.leonardo.ai/...
    const referer = req.headers['referer'] || req.headers['referrer'];
    if (referer) {
        try {
            const url = new URL(referer);
            const subMatch = url.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
            if (subMatch) {
                return subMatch[1];
            }
        } catch (e) {}
    }
    // 4. Default: root domain
    return null;
}

function getTargetUrl(req, config, currentBrowserUrl) {
    const sub = inferSubdomain(req, config, currentBrowserUrl);
    let rest = req.path;
    // If path-based, strip the /sub-leonardo-ai prefix
    const subdomainPattern = /^\/([a-z0-9-]+)-leonardo-ai(\/.*)?$/i;
    const match = req.path.match(subdomainPattern);
    if (match) {
        rest = match[2] || '/';
    }
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    if (sub) {
        return `https://${sub}.leonardo.ai${rest}${query}`;
    } else {
        return `https://${config.targetDomain}${req.path}${query}`;
    }
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

    const sid = getSessionId(req);

    // Compute original and modified target URLs
    const incomingUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    const originalTargetUrl = `https://${config.targetDomain}${req.originalUrl}`;
    let currentBrowserUrl = '[none]';
    const page = sessionPages.get(sid);
    if (page) {
        try {
            currentBrowserUrl = await page.url();
        } catch (e) {
            currentBrowserUrl = '[error retrieving URL]';
        }
    }
    console.log(chalk.magenta('Current Browser URL: ') + currentBrowserUrl);
    console.log(chalk.green('Incoming URL: ') + incomingUrl);
    console.log(chalk.yellow('Original Target URL: ') + originalTargetUrl);
    const modifiedTargetUrl = getTargetUrl(req, config, currentBrowserUrl);
    console.log(chalk.cyan('Modified Target URL: ') + modifiedTargetUrl);

    debugLog(`[${requestId}] Accept header: ${req.headers['accept']}`);
    const isHtml = isHtmlRequest(req);
    debugLog(`[${requestId}] isHtmlRequest: ${isHtml}`);

    if (!isHtml) {
        debugLog(`[${requestId}] Non-HTML request: No Puppeteer page will be created or used.`);
        const assetUrl = getTargetUrl(req, config, currentBrowserUrl);
        // Forward all headers except a few hop-by-hop and proxy-specific ones
        const filteredHeaders = {};
        const assetUrlObj = new URL(assetUrl);
        for (const [key, value] of Object.entries(req.headers)) {
            const lowerKey = key.toLowerCase();
            if (
                lowerKey.startsWith('!~') ||
                lowerKey.startsWith('x-forwarded-') ||
                lowerKey === 'connection' ||
                lowerKey === 'accept-encoding' ||
                lowerKey === 'content-length' ||
                lowerKey === 'host'
            ) {
                continue;
            }
            filteredHeaders[key] = value;
        }
        // Set Host header to target host
        filteredHeaders['host'] = assetUrlObj.host;
        // Set Referer header to incoming Referer or current browser URL
        if (req.headers['referer']) {
            filteredHeaders['referer'] = req.headers['referer'];
        } else if (currentBrowserUrl && currentBrowserUrl !== '[none]' && currentBrowserUrl !== '[error retrieving URL]') {
            filteredHeaders['referer'] = currentBrowserUrl;
        }
        // Set Origin header to target origin if present in incoming request
        if (req.headers['origin']) {
            filteredHeaders['origin'] = assetUrlObj.origin;
        }
        // Extra debug for /.well-known/vercel/security/*
        if (/^\/\.well-known\/vercel\/security\//.test(req.path)) {
            debugLog(`[${requestId}] [SECURITY] Outgoing request details`, {
                method: req.method,
                url: assetUrl,
                headers: filteredHeaders,
                body: req.body && Object.keys(req.body).length > 0 ? req.body : '[stream or empty]'
            });
        }
        debugLog(`[${requestId}] Proxying ${req.method} request`, {
            incomingUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
            targetUrl: assetUrl
        });
        try {
            // Forward the body correctly for POST/PUT/PATCH
            let body = undefined;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                if (req.body && Object.keys(req.body).length > 0) {
                    if (filteredHeaders['content-type'] && filteredHeaders['content-type'].includes('application/json')) {
                        body = JSON.stringify(req.body);
                    } else if (filteredHeaders['content-type'] && filteredHeaders['content-type'].includes('application/x-www-form-urlencoded')) {
                        body = new URLSearchParams(req.body).toString();
                    } else {
                        body = req.body;
                    }
                } else {
                    body = req;
                }
            }
            const fetchOptions = {
                method: req.method,
                headers: filteredHeaders,
                redirect: 'manual',
                body: body
            };
            const assetRes = await fetch(assetUrl, fetchOptions);
            // Forward all response headers
            assetRes.headers.forEach((value, key) => {
                res.setHeader(key, value);
            });
            res.status(assetRes.status);
            assetRes.body.pipe(res);
            return;
        } catch (error) {
            debugLog(`[${requestId}] Error proxying non-HTML request:`, error);
            res.status(502).send('Error fetching resource');
            return;
        }
    } else {
        // HTML requests: use Puppeteer
        const targetUrl = getTargetUrl(req, config, currentBrowserUrl);
        let page = sessionPages.get(sid);
        if (page) {
            debugLog(`[${requestId}] Reusing existing Puppeteer page for session ${sid}`);
        } else {
            debugLog(`[${requestId}] Creating new Puppeteer page for session ${sid}`);
            page = await browser.newPage();
            sessionPages.set(sid, page);
            debugLog(`[${requestId}] New Puppeteer page created for session ${sid}`);
            debugLog(`[${requestId}] Configuring page settings`);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            });
            debugLog(`[${requestId}] Setting cookies`);
            const urlObj = new URL(targetUrl);
            const domain = urlObj.hostname;
            const cookiesToSet = allCookies.filter(cookie => {
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
                page.on('request', async request => {
                    try {
                        await request.continue();
                    } catch (error) {
                        debugLog(`[${requestId}] Error continuing request:`, error);
                    }
                });
            } catch (error) {
                debugLog(`[${requestId}] Failed to set up request interception:`, error);
            }
            page.on('console', msg => {
                debugLog(`[${requestId}] Console ${msg.type()}:`, msg.text());
            });
        }
        try {
            console.log(chalk.blue(`[${requestId}] Navigating to target URL: ${targetUrl}`));
            const navigationPromise = page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: NAVIGATION_TIMEOUT
            });
            await page.waitForFunction(() => {
                return document.readyState === 'interactive' || document.readyState === 'complete';
            }, { timeout: 5000 }).catch(() => {});
            debugLog(`[${requestId}] Getting initial HTML content`);
            let initialHtml = await page.content();

            // Set session cookie for all requests
            res.cookie('sid', sid, {
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'none'
            });

            debugLog(`[${requestId}] Setting response headers`);
            res.set('Content-Type', 'text/html');
            debugLog(`[${requestId}] Sending initial HTML response`);
            res.status(200).send(initialHtml);
            await navigationPromise;
            debugLog(`[${requestId}] Full page load completed`);
        } catch (error) {
            debugLog(`[${requestId}] Error processing HTML request:`, error);
            if (!res.headersSent) {
                res.status(500).send('Internal Server Error');
            }
        }
    }
});

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