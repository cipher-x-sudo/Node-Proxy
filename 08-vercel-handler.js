const chalk = require('chalk');
const { debugLog, isVercelSecurityRequest } = require('./02-utilities');
const config = require('./config');

/**
 * Vercel Security Challenge Handler
 * 
 * This module handles all Vercel security challenge related functionality:
 * - Detecting Vercel security requests
 * - Setting proper headers for challenge requests
 * - Handling WebAssembly files
 * - URL rewriting for security endpoints
 * - Challenge response processing
 */

/**
 * Check if a request is specifically a challenge request
 */
function isChallengeRequest(req) {
    return req.path.includes('vercel/security/request-challenge');
}

/**
 * Check if a request is for a WebAssembly file
 */
function isWebAssemblyRequest(req) {
    return req.path.includes('.wasm');
}

/**
 * Set up proper headers for Vercel security requests
 */
function setupVercelHeaders(req, filteredHeaders) {
    if (isVercelSecurityRequest(req)) {
        console.log(chalk.yellow.bold(`Handling Vercel security request: ${req.path}`));
        
        // Ensure proper headers for challenge requests
        if (req.method === 'POST' && isChallengeRequest(req)) {
            filteredHeaders['content-type'] = 'application/json';
            filteredHeaders['accept'] = 'application/json';
        }
        
        // For WebAssembly files, ensure proper content type
        if (isWebAssemblyRequest(req)) {
            filteredHeaders['accept'] = 'application/wasm';
        }
    }
}

/**
 * Handle Vercel security response processing
 */
async function handleVercelResponse(req, res, assetRes, requestId) {
    if (isVercelSecurityRequest(req)) {
        console.log(chalk.cyan(`[${requestId}] Vercel security response status: ${assetRes.status}`));
        
        // Forward all headers for security requests
        assetRes.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });
        
        // Set proper content type for WebAssembly
        if (isWebAssemblyRequest(req)) {
            res.setHeader('content-type', 'application/wasm');
        }
        
        res.status(assetRes.status);
        
        // For challenge responses, log the response
        if (isChallengeRequest(req) && assetRes.status === 200) {
            const responseText = await assetRes.text();
            console.log(chalk.green(`[${requestId}] Challenge response received: ${responseText.substring(0, 200)}...`));
            res.send(responseText);
        } else {
            assetRes.body.pipe(res);
        }
        return true; // Indicate that we handled the response
    }
    return false; // Indicate that we didn't handle the response
}

/**
 * Create a request interceptor for Vercel security URL rewriting
 */
function createVercelRequestInterceptor(page, requestId) {
    return async (request) => {
        const url = request.url();
        
        // Check if this is a Leonardo.ai URL that needs subdomain prefix
        try {
            const urlObj = new URL(url);
            const isLeonardoUrl = urlObj.hostname === 'leonardo.ai' || urlObj.hostname.endsWith('.leonardo.ai');
            const hasSubdomainPrefix = urlObj.pathname.includes(config.subdomainMarker);
            
            if (isLeonardoUrl && !hasSubdomainPrefix) {
                // Extract the path from the URL
            const path = urlObj.pathname;
            
            // Check if we have a subdomain from the current page URL
            let subdomain = null;
            try {
                const currentUrl = await page.url();
                if (currentUrl && currentUrl !== '[none]' && currentUrl !== '[error retrieving URL]') {
                    const currentUrlObj = new URL(currentUrl);
                    const subMatch = currentUrlObj.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
                    if (subMatch) {
                        subdomain = subMatch[1];
                    }
                }
            } catch (e) {}
            
            // If we have a subdomain, rewrite the URL
            if (subdomain) {
                const newUrl = `https://${config.proxyDomain}/${subdomain}${config.subdomainMarker}${path}${urlObj.search}`;
                    console.log(chalk.magenta.bold(`[${requestId}] Rewriting Leonardo.ai URL: ${url} -> ${newUrl}`));
                request.continue({ url: newUrl });
                return;
            }
            }
        } catch (e) {
            console.log(chalk.red(`[${requestId}] Error parsing URL in interceptor:`, e));
        }
        
        // Continue with original request
        request.continue();
    };
}

/**
 * Set up request interception for Vercel security URL rewriting
 */
async function setupVercelRequestInterception(page, requestId) {
    try {
        await page.setRequestInterception(true);
        page.removeAllListeners('request');
        page.on('request', createVercelRequestInterceptor(page, requestId));
    } catch (error) {
        console.log(chalk.red(`[${requestId}] Error setting up Vercel request interception:`, error));
    }
}

/**
 * Check if a page contains Vercel security challenges
 */
function hasVercelChallenge(pageContent) {
    return pageContent.includes('vercel/security') || pageContent.includes('challenge');
}

/**
 * Handle Vercel challenge page detection and processing
 */
async function handleVercelChallengePage(page, requestId) {
    const pageContent = await page.content();
    if (hasVercelChallenge(pageContent)) {
        console.log(chalk.green.bold(`[${requestId}] Detected security challenge page, ensuring script execution`));
        
        // Wait for any dynamic content to load
        await page.waitForTimeout(2000);
        
        // Ensure the page is fully loaded
        await page.waitForFunction(() => {
            return document.readyState === 'complete';
        }, { timeout: 10000 }).catch(() => {});
        
        return true;
    }
    else { 
        console.log(chalk.red(`No Vercel challenge found`));
    }
    return false;
}

/**
 * Log Vercel security challenge detection
 */
function logVercelChallenge(req, requestId) {
    if (isChallengeRequest(req)) {
        console.log(chalk.yellow.bold(`[${requestId}] New request received - VERCEL SECURITY CHALLENGE`, {
            method: req.method,
            path: req.path
        }));
    }
}

module.exports = {
    isVercelSecurityRequest,
    isChallengeRequest,
    isWebAssemblyRequest,
    setupVercelHeaders,
    handleVercelResponse,
    createVercelRequestInterceptor,
    setupVercelRequestInterception,
    hasVercelChallenge,
    handleVercelChallengePage,
    logVercelChallenge
}; 