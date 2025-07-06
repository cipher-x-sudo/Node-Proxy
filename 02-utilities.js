const chalk = require('chalk');
const fetch = require('node-fetch');

// Try to load https-proxy-agent, fallback to direct fetch if not available
let HttpsProxyAgent = null;
try {
    const HttpsProxyAgentModule = require('https-proxy-agent');
    HttpsProxyAgent = HttpsProxyAgentModule.HttpsProxyAgent || HttpsProxyAgentModule;
} catch (error) {
    console.log('Warning: https-proxy-agent not installed, proxy requests will use direct connection');
}

// Rate limiting utilities
const requestTimestamps = new Map();
const MAX_REQUESTS_PER_MINUTE = 300; // Increased limit for normal browsing
const RATE_LIMIT_WINDOW = 60000; // 1 minute in milliseconds

// Proxy-enabled fetch function
function createProxyFetch(config) {
    
    if (!config.proxy.enabled) {
        debugLog('Proxy disabled, returning direct fetch');
        return fetch;
    }
    
    debugLog('Proxy enabled, checking for HttpsProxyAgent');
    
    // If https-proxy-agent is not available, fallback to direct fetch
    if (!HttpsProxyAgent) {
        debugLog('Warning: Proxy enabled but https-proxy-agent not available, using direct connection');
        return fetch;
    }
    
    debugLog('HttpsProxyAgent available, creating proxy agent');
    
    try {
        const proxyUrl = `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.host}:${config.proxy.port}`;
        const agent = new HttpsProxyAgent(proxyUrl);
        
        debugLog('Proxy agent created successfully');
        
        return (url, options = {}) => {
            debugLog(`Making proxy request to: ${url}`);
            return fetch(url, {
                ...options,
                agent: agent
            });
        };
    } catch (error) {
        debugLog(`Error creating proxy agent: ${error.message}`);
        return fetch;
    }
}

function checkRateLimit(requestId, req = null) {
    // Skip rate limiting for certain types of requests
    if (req) {
        // Skip rate limiting for favicon and other essential assets
        if (req.path.includes('favicon.ico') || 
            req.path.includes('robots.txt') ||
            req.path.includes('sitemap') ||
            req.path.includes('manifest.json')) {
            return true;
        }
        
        // Skip rate limiting for Vercel security challenges
        if (isVercelSecurityRequest(req)) {
            return true;
        }
    }
    
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    // Clean up old timestamps
    for (const [timestamp] of requestTimestamps) {
        if (timestamp < windowStart) {
            requestTimestamps.delete(timestamp);
        }
    }
    
    // Count requests in current window
    const requestCount = requestTimestamps.size;
    
    if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
        debugLog(`[${requestId}] Rate limit exceeded: ${requestCount} requests in last minute`);
        return false;
    }
    
    // Add current request timestamp
    requestTimestamps.set(now, requestId);
    return true;
}

function addRequestDelay() {
    // Add a small delay between requests to avoid overwhelming the server
    return new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
}

function getActivePageCount(sessionPages) {
    return sessionPages.size;
}

function logPageCount(sessionPages) {
    const count = getActivePageCount(sessionPages);
    console.log(chalk.cyan(`[PAGE COUNT] Currently active pages: ${count}`));
}

function cleanupInactivePages(sessionPages) {
    const now = Date.now();
    const maxInactiveTime = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;
    
    for (const [sid, page] of sessionPages.entries()) {
        try {
            // Check if page is still responsive
            page.url().catch(() => {
                // Page is not responsive, remove it
                sessionPages.delete(sid);
                cleanedCount++;
            });
        } catch (error) {
            // Page is broken, remove it
            sessionPages.delete(sid);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(chalk.yellow(`[CLEANUP] Removed ${cleanedCount} inactive pages`));
        logPageCount(sessionPages);
    }
}

function debugLog(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    if (data) {
        console.log('Data:', JSON.stringify(data, null, 2));
    }
}

function logStatusWithColor(requestId, statusCode, message = '') {
    const timestamp = new Date().toISOString();
    let colorFunction;
    
    // Color coding based on status code ranges
    if (statusCode >= 200 && statusCode < 300) {
        colorFunction = chalk.green; // Success - Green
    } else if (statusCode >= 300 && statusCode < 400) {
        colorFunction = chalk.blue; // Redirect - Blue
    } else if (statusCode >= 400 && statusCode < 500) {
        if (statusCode === 429) {
            colorFunction = chalk.yellow; // Rate limit - Yellow
        } else {
            colorFunction = chalk.red; // Client error - Red
        }
    } else if (statusCode >= 500) {
        colorFunction = chalk.magenta; // Server error - Magenta
    } else {
        colorFunction = chalk.white; // Unknown - White
    }
    
    const statusText = `${statusCode}`;
    const coloredStatus = colorFunction.bold(statusText);
    const logMessage = `[${timestamp}] [${requestId}] ${coloredStatus} ${message}`;
    console.log(logMessage);
}

function isStaticAsset(path) {
    return /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|otf|webp|mp4|webm|ogg|mp3|wav|m4a|json|xml|txt|map|wasm|woff|eot|otf|ttf|woff2)(\?.*)?$/i.test(path);
}

/**
 * Check if a request is a Vercel security challenge
 */
function isVercelSecurityRequest(req) {
    return req.path.includes('vercel/security/');
}

function isHtmlRequest(req) {
    if (isVercelSecurityRequest(req)) {
        return false;
    }
    
    // First check if it's a static asset - these are never HTML
    if (isStaticAsset(req.path)) {
        return false;
    }
    
    // Check if it's explicitly an HTML file
    if (/\.html(\?.*)?$/i.test(req.path)) {
        return true;
    }
    
    // Check if it's a root path or has no extension (likely HTML)
    if (req.path === '/' || req.path === '' || !/\.[a-z0-9]+$/i.test(req.path)) {
        const accept = req.headers['accept'] || '';
        // Only consider it HTML if it explicitly accepts text/html and doesn't accept other types
        return accept.includes('text/html') && !accept.includes('application/json') && !accept.includes('text/css') && !accept.includes('application/javascript');
    }
    
    return false;
}

module.exports = {
    getActivePageCount,
    logPageCount,
    cleanupInactivePages,
    debugLog,
    logStatusWithColor,
    isStaticAsset,
    isVercelSecurityRequest,
    isHtmlRequest,
    checkRateLimit,
    addRequestDelay,
    createProxyFetch
}; 