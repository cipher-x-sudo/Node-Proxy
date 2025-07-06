const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { debugLog, checkRateLimit, addRequestDelay, logStatusWithColor, createProxyFetch } = require('./02-utilities');
const config = require('./config');
const { createPage } = require('./03-browser-manager');
const { getSubdomainFromSession } = require('./06-url-utils');
const { 
    isVercelSecurityRequest,
    isChallengeRequest,
    isWebAssemblyRequest,
    setupVercelHeaders,
    handleVercelResponse,
    setupVercelRequestInterception,
    hasVercelChallenge,
    handleVercelChallengePage,
    logVercelChallenge
} = require('./08-vercel-handler');
const { rewriteHtmlUrls } = require('./14-server-url-rewriter');

// Individual scripts are now injected separately



async function handleNonHtmlRequest(req, res, targetUrl, currentBrowserUrl, requestId) {
    // Only keep critical logs
    // debugLog(`[${requestId}] Starting handleNonHtmlRequest`);
    if (!checkRateLimit(requestId, req)) {
        logStatusWithColor(requestId, 429, 'Rate limit exceeded');
        res.status(429).send('Too Many Requests - Rate limit exceeded');
        return;
    }
    // debugLog(`[${requestId}] Rate limit check passed`);
    await addRequestDelay();
    // debugLog(`[${requestId}] Non-HTML request: Proxying directly`);
    // debugLog(`[${requestId}] Request path: ${req.path}`);
    // debugLog(`[${requestId}] Target URL: ${targetUrl}`);
    const assetUrl = targetUrl;
    const filteredHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'connection' || lowerKey === 'content-length') continue;
        filteredHeaders[key] = value;
    }
    const assetUrlObj = new URL(assetUrl);
    filteredHeaders['host'] = assetUrlObj.host;
    if (!req.headers['referer'] && currentBrowserUrl && currentBrowserUrl !== '[none]' && currentBrowserUrl !== '[error retrieving URL]') {
        filteredHeaders['referer'] = currentBrowserUrl;
    }
    if (req.headers['origin']) {
        filteredHeaders['origin'] = assetUrlObj.origin;
    }
    setupVercelHeaders(req, filteredHeaders);
    try {
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
            }
        }
        const proxyFetch = createProxyFetch(config);
        let assetRes;
        try {
            assetRes = await proxyFetch(assetUrl, {
                method: req.method,
                headers: filteredHeaders,
                redirect: 'manual',
                body: body
            });
            logStatusWithColor(requestId, assetRes.status, `Response content-type: ${assetRes.headers.get('content-type')}`);
        } catch (error) {
            logStatusWithColor(requestId, 502, 'Error fetching resource');
            throw error;
        }
        const handled = await handleVercelResponse(req, res, assetRes, requestId);
        if (!handled) {
            assetRes.headers.forEach((value, key) => {
                if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding') {
                    res.setHeader(key, value);
                }
            });
            res.status(assetRes.status);
            try {
                const buffer = await assetRes.buffer();
                res.send(buffer);
            } catch (error) {
                assetRes.body.pipe(res);
            }
        }
    } catch (error) {
        logStatusWithColor(requestId, 502, 'Error fetching resource');
        res.status(502).send('Error fetching resource');
    }
}

async function handleHtmlRequest(req, res, targetUrl, sid, sessionPages, browser, allCookies, requestId) {
    if (!checkRateLimit(requestId, req)) {
        logStatusWithColor(requestId, 429, 'Rate limit exceeded for HTML request');
        res.status(429).send('Too Many Requests - Rate limit exceeded');
        return;
    }
    let page = sessionPages.get(sid);
    if (page) {
        await setupVercelRequestInterception(page, requestId);
    }
    if (!page) {
        page = await createPage();
        sessionPages.set(sid, page);
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
        await page.setJavaScriptEnabled(true);
        await setupVercelRequestInterception(page, requestId);
    }
    try {
        const currentUrl = await page.url();
        if (currentUrl !== targetUrl) {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        }
        await handleVercelChallengePage(page, requestId);
        let initialHtml = await page.content();
        const subdomain = await getSubdomainFromSession(sid, sessionPages);
        initialHtml = rewriteHtmlUrls(initialHtml, config);
        // Inject scripts separately for better readability and debugging
        const configScript = `<script id="makers-config" type="text/javascript">window.proxyConfig = ${JSON.stringify(config)};</script>`;
        const urlRewriterScript = fs.readFileSync(path.join(__dirname, '11-url-rewriter.js'), 'utf8');
        const urlRewriterTag = `<script id="makers-url-rewriter" type="text/javascript">${urlRewriterScript}</script>`;
        const modalScript = fs.readFileSync(path.join(__dirname, '12-modal-manipulator.js'), 'utf8');
        const modalTag = `<script id="makers-modal" type="text/javascript">${modalScript}</script>`;
        const debugScript = fs.readFileSync(path.join(__dirname, '13-debug-indicator.js'), 'utf8');
        const debugTag = `<script id="makers-debug" type="text/javascript">${debugScript}</script>`;
        const allScripts = configScript + urlRewriterTag + modalTag + debugTag;
        if (initialHtml.includes('</body>')) {
            initialHtml = initialHtml.replace('</body>', allScripts + '</body>');
        } else {
            initialHtml += allScripts;
        }
        res.cookie('sid', sid, {
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none'
        });
        res.set('Content-Type', 'text/html');
        logStatusWithColor(requestId, 200, 'HTML response sent successfully');
        res.status(200).send(initialHtml);
    } catch (error) {
        logStatusWithColor(requestId, 500, 'Internal Server Error');
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error');
        }
    }
}

module.exports = {
    handleHtmlRequest,
    handleNonHtmlRequest
}; 