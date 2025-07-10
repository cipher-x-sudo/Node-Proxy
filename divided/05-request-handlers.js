// Updated 05-request-handlers.js for path-based routing
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { debugLog, checkRateLimit, addRequestDelay, logStatusWithColor, createProxyFetch } = require('./02-utilities');
const config = require('./config');
const { createPage } = require('./03-browser-manager');
const { getSubdomainFromSession, extractPathInfo } = require('./06-url-utils');
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

// Updated server-side URL rewriter for path-based routing
function rewriteHtmlUrlsPathBased(html, config, pathInfo) {
    if (!html || !config) return html;
    
    const domainPattern = config.targetDomain.replace(/\./g, '\\\\.');
    
    // Match http(s)://subdomain.leonardo.ai or http(s)://leonardo.ai
    const urlRegex = new RegExp(`(https?:\\/\\/)(?:([a-z0-9-]+)\\.)?($\{domainPattern})`, 'gi');
    
    const replacement = function(match, proto, subdomain, domain) {
        subdomain = subdomain || 'app'; // default to app if no subdomain
        const fullDomain = subdomain ? `$\{subdomain}.$\{domain}` : domain;
        const rewritten = `$\{proto}$\{config.proxyDomain}$\{config.pathPrefix}/$\{fullDomain}`;
        
        console.log(`[SERVER PATH REWRITE] $\{match} -> $\{rewritten}`);
        return rewritten;
    };
    
    return html.replace(urlRegex, replacement);
}

async function handleNonHtmlRequest(req, res, targetUrl, currentBrowserUrl, requestId) {
    if (!checkRateLimit(requestId, req)) {
        logStatusWithColor(requestId, 429, 'Rate limit exceeded');
        res.status(429).send('Too Many Requests - Rate limit exceeded');
        return;
    }
    
    await addRequestDelay();
    
    const assetUrl = targetUrl;
    const filteredHeaders = {};
    
    // Copy headers, excluding connection and content-length
    for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'connection' || lowerKey === 'content-length') continue;
        filteredHeaders[key] = value;
    }
    
    // Set proper host header for target
    const assetUrlObj = new URL(assetUrl);
    filteredHeaders['host'] = assetUrlObj.host;
    
    // Set referer if not present
    if (!req.headers['referer'] && currentBrowserUrl && currentBrowserUrl !== '[none]' && currentBrowserUrl !== '[error retrieving URL]') {
        filteredHeaders['referer'] = currentBrowserUrl;
    }
    
    // Set origin header
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
            logStatusWithColor(requestId, assetRes.status, `Response content-type: $\{assetRes.headers.get('content-type')}`);
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

async function handleHtmlRequest(req, res, targetUrl, sid, sessionPages, browser, allCookies, requestId, pathInfo = null) {
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
        
        // Set cookies for the target domain
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
        
        // Apply path-based URL rewriting
        if (pathInfo) {
            initialHtml = rewriteHtmlUrlsPathBased(initialHtml, config, pathInfo);
        } else {
            // Fallback to original rewriting for backwards compatibility
            const { rewriteHtmlUrls } = require('./14-server-url-rewriter');
            initialHtml = rewriteHtmlUrls(initialHtml, config);
        }
        
        // Create client scripts for path-based routing
        const configScript = `<script id="makers-config" type="text/javascript">window.proxyConfig = $\{JSON.stringify(config)};</script>`;
        
        // Updated URL rewriter for path-based routing
        const pathBasedUrlRewriterScript = `
        (function() {
            "use strict";
            
            console.log("[PATH-BASED URL REWRITER] Script starting...");
            
            const CONFIG = window.proxyConfig || {};
            console.log("[PATH-BASED URL REWRITER] Config loaded:", CONFIG);
            
            function getCurrentPathInfo() {
                const pathname = window.location.pathname;
                const pathRegex = new RegExp("^" + CONFIG.pathPrefix + "\\\\/([^\\\\/]+)(\\\\/.*)?$");
                const pathMatch = pathname.match(pathRegex);
                
                if (pathMatch) {
                    const hostPart = pathMatch[1];
                    const remainingPath = pathMatch[2] || '/';
                    
                    let subdomain = 'app';
                    if (hostPart.includes('.leonardo.ai')) {
                        if (hostPart === 'leonardo.ai') {
                            subdomain = 'app';
                        } else {
                            const parts = hostPart.split('.');
                            if (parts.length >= 3 && parts[1] === 'leonardo' && parts[2] === 'ai') {
                                subdomain = parts[0];
                            }
                        }
                    } else {
                        subdomain = hostPart;
                    }
                    
                    return { subdomain, hostPart, remainingPath };
                }
                
                return { subdomain: 'app', hostPart: 'app.leonardo.ai', remainingPath: '/' };
            }
            
            function rewriteUrl(url) {
                const pathInfo = getCurrentPathInfo();
                
                try {
                    const urlObj = new URL(url, window.location.origin);
                    
                    // Skip external domains
                    const externalDomains = [
                        'consent.cookiefirst.com',
                        'cdn.jsdelivr.net', 
                        'fonts.googleapis.com',
                        'fonts.gstatic.com',
                        'google-analytics.com',
                        'googletagmanager.com'
                    ];
                    
                    if (externalDomains.some(domain => urlObj.hostname.includes(domain))) {
                        return url;
                    }
                    
                    // Check if this is a Leonardo.ai URL that needs rewriting
                    const leonardoDomainRegex = /^(?:[a-z0-9-]+\\\\.)?leonardo\\\\.ai$/i;
                    const isLeonardoUrl = leonardoDomainRegex.test(urlObj.hostname);
                    
                    if (isLeonardoUrl) {
                        // Rewrite to path-based format: /leonardo/subdomain.leonardo.ai/path
                        const newUrl = window.location.protocol + "//" + window.location.host + 
                                      CONFIG.pathPrefix + "/" + urlObj.hostname + urlObj.pathname + urlObj.search;
                        
                        console.log("%c[PATH URL REWRITE] %c" + url + " → " + newUrl, 
                                   "color: #0066ff; font-weight: bold;", "color: #0066ff;");
                        return newUrl;
                    }
                    
                    // For relative URLs, convert to path-based format
                    if (!urlObj.hostname || urlObj.hostname === window.location.hostname) {
                        if (urlObj.pathname.startsWith("/") && !urlObj.pathname.startsWith(CONFIG.pathPrefix)) {
                            const targetHost = pathInfo.subdomain + ".leonardo.ai";
                            const newUrl = window.location.protocol + "//" + window.location.host + 
                                          CONFIG.pathPrefix + "/" + targetHost + urlObj.pathname + urlObj.search;
                            
                            console.log("%c[RELATIVE URL REWRITE] %c" + url + " → " + newUrl, 
                                       "color: #0088ff; font-weight: bold;", "color: #0088ff;");
                            return newUrl;
                        }
                    }
                    
                } catch (e) {
                    console.warn("URL rewrite error:", e);
                    return url;
                }
                
                return url;
            }
            
            // Track processed elements
            const processedElements = new WeakSet();
            
            function replaceAttributes(el) {
                if (processedElements.has(el)) return;
                
                CONFIG.attributes.forEach(attr => {
                    if(el[attr]) {
                        let newVal = el[attr];
                        const rewrittenUrl = rewriteUrl(newVal);
                        if(rewrittenUrl !== newVal) {
                            const fileName = el.tagName.toLowerCase() + "[" + attr + "]";
                            console.log("%c[ELEMENT REWRITE] %c" + fileName + " → " + rewrittenUrl, 
                                       "color: #00aa00; font-weight: bold;", "color: #00aa00;");
                            el[attr] = rewrittenUrl;
                            processedElements.add(el);
                        }
                    }
                });
            }
            
            // Override fetch
            const originalFetch = window.fetch;
            window.fetch = function(url, options = {}) {
                const rewrittenUrl = rewriteUrl(url);
                if (rewrittenUrl !== url) {
                    console.log("%c[FETCH REWRITE] %c" + url + " → " + rewrittenUrl, 
                               "color: #ff6600; font-weight: bold;", "color: #ff6600;");
                }
                return originalFetch.call(this, rewrittenUrl, options);
            };
            
            // Override XMLHttpRequest
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...args) {
                const rewrittenUrl = rewriteUrl(url);
                if (rewrittenUrl !== url) {
                    console.log("%c[XHR REWRITE] %c" + url + " → " + rewrittenUrl, 
                               "color: #ff6600; font-weight: bold;", "color: #ff6600;");
                }
                return originalOpen.call(this, method, rewrittenUrl, ...args);
            };
            
            // Handle dynamic elements
            const observer = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    if (mutation.addedNodes) {
                        mutation.addedNodes.forEach(node => {
                            if(node.nodeType === 1) {
                                const selector = CONFIG.tags.map(t => 
                                    CONFIG.attributes.map(a => \`\${t}[\${a}]\`).join(",")
                                ).join(",");
                                Array.from(node.querySelectorAll(selector)).forEach(replaceAttributes);
                                replaceAttributes(node);
                            }
                        });
                    }
                    if (mutation.type === "attributes" && CONFIG.attributes.includes(mutation.attributeName)) {
                        replaceAttributes(mutation.target);
                    }
                });
            });
            
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: CONFIG.attributes
            });
            
            // Initial replacement
            const selector = CONFIG.tags.map(t => 
                CONFIG.attributes.map(a => \`\${t}[\${a}]\`).join(",")
            ).join(",");
            document.querySelectorAll(selector).forEach(replaceAttributes);
            
            // Fallback interval
            setInterval(() => {
                document.querySelectorAll(selector).forEach(replaceAttributes);
            }, 2000);
            
            console.log("[PATH-BASED URL REWRITER] System initialized successfully!");
            
        })();`;
        
        const urlRewriterTag = `<script id="makers-path-url-rewriter" type="text/javascript">$\{pathBasedUrlRewriterScript}</script>`;
        
        // Load other scripts
        const modalScript = fs.readFileSync(path.join(__dirname, '12-modal-manipulator.js'), 'utf8');
        const modalTag = `<script id="makers-modal" type="text/javascript">$\{modalScript}</script>`;
        
        const debugScript = fs.readFileSync(path.join(__dirname, '13-debug-indicator.js'), 'utf8');
        const debugTag = `<script id="makers-debug" type="text/javascript">$\{debugScript}</script>`;
        
        const allScripts = configScript + urlRewriterTag + modalTag + debugTag;
        
        // Inject scripts
        if (initialHtml.includes('</body>')) {
            initialHtml = initialHtml.replace('</body>', allScripts + '</body>');
        } else {
            initialHtml += allScripts;
        }
        
        // Set session cookie
        res.cookie('sid', sid, {
            maxAge: 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none'
        });
        
        res.set('Content-Type', 'text/html');
        logStatusWithColor(requestId, 200, 'HTML response sent successfully (path-based)');
        res.status(200).send(initialHtml);
        
    } catch (error) {
        console.error('[HTML REQUEST ERROR]', error);
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