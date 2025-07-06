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
const { logStatusWithColor } = require('./02-utilities');

puppeteer.use(StealthPlugin());

const PORT = process.env.PORT || 3001;
const app = express();
const sessionPages = new Map();

// Import utility functions
const { 
    getActivePageCount, 
    logPageCount, 
    cleanupInactivePages,
    debugLog,
    isHtmlRequest,
    isStaticAsset
} = require('./02-utilities');

// Import browser management
const { initBrowser } = require('./03-browser-manager');

// Import cookie management
const { loadCookies } = require('./04-cookie-manager');

// Import request handlers
const { handleHtmlRequest, handleNonHtmlRequest } = require('./05-request-handlers');

// Import Vercel handler
const { logVercelChallenge } = require('./08-vercel-handler');

// Import URL utilities
const { getTargetUrl, inferSubdomain, getSubdomainFromSession } = require('./06-url-utils');

// Import session management
const { getSessionId } = require('./07-session-manager');

let browser = null;
let allCookies = [];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: '*', credentials: true }));
app.use(helmet({ 
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'", "https:", "data:", "blob:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "blob:"],
            scriptSrcElem: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "blob:"],
            workerSrc: ["'self'", "blob:", "data:"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https:", "wss:", "ws:"],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "https:", "blob:"],
            frameSrc: ["'self'", "https:"],
            childSrc: ["'self'", "blob:"],
            manifestSrc: ["'self'", "https:"]
        }
    }
}));

// Debug log endpoint for client-side logs
app.post('/__debug_log', express.json(), (req, res) => {
    const { type, from, to, element } = req.body;
    if (type === 'url_rewrite') {
        console.log(chalk.green(`[CLIENT LOG] URL Rewrite: ${from} → ${to}`));
    } else if (type === 'file_rewrite') {
        console.log(chalk.green(`[CLIENT LOG] File Rewrite: ${element} → ${to}`));
    }
    res.status(200).send('OK');
});

app.all('*', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    // Only keep essential logs
    // Check if this is a vercel security request
    logVercelChallenge(req, requestId);
    const sid = getSessionId(req);
    const page = sessionPages.get(sid);
    let currentBrowserUrl = '[none]';
    if (page) {
        try {
            currentBrowserUrl = await page.url();
        } catch (e) {
            currentBrowserUrl = '[error retrieving URL]';
        }
    }
    
    // Get subdomain from multiple sources with priority order
    let subdomain = null;
    
    // 1. First try to infer from current request
    subdomain = inferSubdomain(req, config, currentBrowserUrl);
    
    // 2. If not found, try to get from session
    if (!subdomain) {
        subdomain = await getSubdomainFromSession(sid, sessionPages);
    }
    
    // 3. If still not found, try to extract from current browser URL
    if (!subdomain && currentBrowserUrl && currentBrowserUrl !== '[none]' && currentBrowserUrl !== '[error retrieving URL]') {
        try {
            const url = new URL(currentBrowserUrl);
            const subMatch = url.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
            if (subMatch) {
                subdomain = subMatch[1];
            }
        } catch (e) {}
    }
    
    // 4. Special handling for Vercel security requests - route to app subdomain if no subdomain detected
    if (!subdomain && req.path.includes('vercel/security/')) {
        subdomain = 'app';
    }
  
    
    // Construct target URL consistently
    let targetUrl = getTargetUrl(req, config, subdomain);
    console.log(chalk.blue('Outgoing URL: ') + targetUrl);

    const isHtml = isHtmlRequest(req);
    const isStatic = isStaticAsset(req.path);
    const accept = req.headers['accept'] || '';
    if (isHtml) {
        logStatusWithColor(requestId, 200, 'Processing as HTML request');
    } else {
        logStatusWithColor(requestId, 200, 'Processing as non-HTML request');
    }
    if (!isHtml) {
        await handleNonHtmlRequest(req, res, targetUrl, currentBrowserUrl, requestId);
    } else {
        await handleHtmlRequest(req, res, targetUrl, sid, sessionPages, browser, allCookies, requestId);
    }
});

async function startServer() {
    try {
        debugLog('Starting server initialization');
        await loadCookies(allCookies);
        browser = await initBrowser();
        app.listen(PORT, () => {
            debugLog(`Server started successfully on port ${PORT}`);
            logPageCount(sessionPages);
            
            // Set up periodic page count logging and cleanup
            setInterval(() => {
                logPageCount(sessionPages);
                cleanupInactivePages(sessionPages);
            }, 5 * 60 * 1000); // Every 5 minutes
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