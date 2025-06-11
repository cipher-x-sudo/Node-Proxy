const express = require('express');
const puppeteer = require('puppeteer');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const fs = require('fs').promises;

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
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: '/home/ownera/.cache/puppeteer/chrome/linux-137.0.7151.55/chrome-linux64/chrome',
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

// Load cookies from JSON file
let allowedCookies = [];
let cookies = {};

async function loadCookies() {
    try {
        debugLog('Loading cookies from file');
        const cookiesData = JSON.parse(await fs.readFile('cookies2.json', 'utf8'));
        allowedCookies = [...new Set(cookiesData.map(cookie => cookie.name))];
        cookies = cookiesData.reduce((acc, cookie) => {
            if (allowedCookies.includes(cookie.name)) {
                acc[cookie.name] = cookie.value;
            }
            return acc;
        }, {});
        debugLog('Cookies loaded successfully', {
            allowedCookies: allowedCookies.length,
            cookies: Object.keys(cookies).length
        });
    } catch (error) {
        debugLog('Error loading cookies:', error);
    }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));
app.use(cookieParser());
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(helmet({
    contentSecurityPolicy: false // Disable CSP to allow all content
}));

// Main proxy handler
app.all('*', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    debugLog(`[${requestId}] New request received`, {
        method: req.method,
        path: req.path,
        query: req.query,
        headers: req.headers
    });

    let page = null;
    try {
        // Build target URL
        const targetUrl = `https://${config.targetDomain}${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
        
        debugLog(`[${requestId}] Target URL constructed`, {
            targetUrl
        });

        // Initialize browser if not already done
        const browser = await initBrowser();
        debugLog(`[${requestId}] Creating new page`);
        page = await browser.newPage();

        // Set up page configuration
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

        // Set cookies
        debugLog(`[${requestId}] Setting cookies`);
        const cookiesArray = Object.entries(cookies).map(([name, value]) => ({
            name,
            value,
            domain: config.targetDomain,
            path: '/'
        }));
        await page.setCookie(...cookiesArray);

        // Set up request interception for debugging
        let requestInterceptor = null;
        try {
            await page.setRequestInterception(true);
            // Wait a small amount of time to ensure interception is fully enabled
            await wait(100);
            requestInterceptor = page.on('request', async request => {
                try {
                    await request.continue();
                } catch (error) {
                    debugLog(`[${requestId}] Error continuing request:`, error);
                }
            });
        } catch (error) {
            debugLog(`[${requestId}] Failed to set up request interception:`, error);
            requestInterceptor = null;
        }

        page.on('console', msg => {
            debugLog(`[${requestId}] Console ${msg.type()}:`, msg.text());
        });

        // Navigate to the target URL with increased timeout and multiple strategies
        debugLog(`[${requestId}] Navigating to target URL`);
        let response;
        try {
            response = await page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: NAVIGATION_TIMEOUT
            });
            debugLog(`[${requestId}] Initial HTML loaded successfully`);
        } catch (error) {
            debugLog(`[${requestId}] Navigation failed, getting current content:`, error);
            const currentUrl = await page.url();
            debugLog(`[${requestId}] Current page URL:`, { currentUrl });
            const content = await page.content();
            debugLog(`[${requestId}] Retrieved content despite navigation error`);
            response = {
                status: () => 200,
                headers: () => ({ 'content-type': 'text/html' }),
                content: () => content
            };
        }

        // Get the final HTML content immediately
        debugLog(`[${requestId}] Getting page content`);
        const body = await page.content();

        // Set response headers
        debugLog(`[${requestId}] Setting response headers`);
        res.set('Content-Type', response.headers()['content-type'] || 'text/html');
        const headers = response.headers();
        Object.entries(headers).forEach(([key, value]) => {
            if (!['content-encoding', 'content-length'].includes(key.toLowerCase())) {
                res.set(key, value);
            }
        });

        // Send response immediately
        debugLog(`[${requestId}] Sending response`, {
            status: response.status()
        });
        res.status(response.status()).send(body);

        // Clean up request interception
        if (requestInterceptor) {
            try {
                debugLog(`[${requestId}] Cleaning up request interception`);
                requestInterceptor.removeAllListeners();
                await page.setRequestInterception(false);
            } catch (error) {
                debugLog(`[${requestId}] Error cleaning up request interception:`, error);
            }
        }

    } catch (error) {
        debugLog(`[${requestId}] Error processing request:`, error);
        res.status(500).send('Internal Server Error');
    } finally {
        // Always close the page
        if (page) {
            try {
                debugLog(`[${requestId}] Closing page`);
                await page.close({ runBeforeUnload: false });
            } catch (closeError) {
                debugLog(`[${requestId}] Error closing page:`, closeError);
            }
        }
    }
});

// Start server
async function startServer() {
    try {
        debugLog('Starting server initialization');
        await loadCookies();
        
        // Initialize browser with retry
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

// Handle graceful shutdown
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