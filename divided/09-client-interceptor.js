// Client-side request interceptor script
// This script intercepts fetch and XMLHttpRequest calls and rewrites URLs

function createClientRequestInterceptor(config) {
    const configJson = JSON.stringify(config);
    
    return '(function() {' +
        '"use strict";' +
        'console.log("[CLIENT INTERCEPTOR] Script starting...");' +
        'const CONFIG = ' + configJson + ';' +
        'console.log("[CLIENT INTERCEPTOR] Initializing with config:", CONFIG);' +
        
        'function getCurrentSubdomain() {' +
            'const hostname = window.location.hostname;' +
            'const pathname = window.location.pathname;' +
            'console.log("[CLIENT INTERCEPTOR] Debug - hostname:", hostname, "pathname:", pathname);' +
            
            '// Try to extract subdomain from path first' +
            'const escapedMarker = CONFIG.subdomainMarker.replace(/[.*+?^\\${}()|[\\]\\\\]/g, "\\\\$&");' +
            'const pathMatch = pathname.match(new RegExp("^\\/([a-z0-9-]+)" + escapedMarker + "\\/", "i"));' +
            'if (pathMatch) {' +
                'console.log("[CLIENT INTERCEPTOR] Found subdomain in path:", pathMatch[1]);' +
                'return pathMatch[1];' +
            '}' +
            
            '// Try to get from referrer' +
            'if (document.referrer) {' +
                'const referrerUrl = new URL(document.referrer);' +
                'const referrerPathMatch = referrerUrl.pathname.match(new RegExp("^\\/([a-z0-9-]+)" + escapedMarker + "\\/", "i"));' +
                'if (referrerPathMatch) {' +
                    'console.log("[CLIENT INTERCEPTOR] Found subdomain in referrer:", referrerPathMatch[1]);' +
                    'return referrerPathMatch[1];' +
                '}' +
            '}' +
            
            '// Fallback to hostname' +
            'const hostMatch = hostname.match(/^([a-z0-9-]+)\\.leonardo\\.ai$/i);' +
            'if (hostMatch) {' +
                'console.log("[CLIENT INTERCEPTOR] Found subdomain in hostname:", hostMatch[1]);' +
                'return hostMatch[1];' +
            '}' +
            
            'console.log("[CLIENT INTERCEPTOR] No subdomain found, using default");' +
            'return "app";' + // Default to 'app' subdomain
        '}' +
        
        'function rewriteUrl(url) {' +
            'const subdomain = getCurrentSubdomain();' +
            'if (!subdomain) {' +
                'return url;' +
            '}' +
            
            '// IMPORTANT: Check for external domains first and skip them completely' +
            'if (url.startsWith("https://") || url.startsWith("http://")) {' +
                'try {' +
                    'const urlObj = new URL(url, window.location.origin);' +
                    
                    '// Validate protocol' +
                    'if (urlObj.protocol !== "https:" && urlObj.protocol !== "http:") {' +
                        'return url;' +
                    '}' +
                    
                    'const leonardoDomainRegex = /^(?:[a-z0-9-]+\\.)?leonardo\\.ai$/i;' +
                    'if (!leonardoDomainRegex.test(urlObj.hostname)) {' +
                        'return url;' +
                    '}' +
                    
                    '// Extra check for specific external domains that should never be rewritten' +
                    'const externalDomainRegex = /^(consent\\.cookiefirst\\.com|cdn\\.jsdelivr\\.net|fonts\\.googleapis\\.com|fonts\\.gstatic\\.com)$/i;' +
                    'if (externalDomainRegex.test(urlObj.hostname)) {' +
                        'return url;' +
                    '}' +
                '} catch (e) {' +
                    'return url;' +
                '}' +
            '}' +
            
            '// Check if this is a Leonardo.ai URL that needs rewriting' +
            'try {' +
                'const urlObj = new URL(url, window.location.origin);' +
                'const leonardoDomainRegex = /^(?:[a-z0-9-]+\\.)?leonardo\\.ai$/i;' +
                'const isLeonardoUrl = leonardoDomainRegex.test(urlObj.hostname);' +
                'const hasSubdomainPrefix = urlObj.pathname.includes(CONFIG.subdomainMarker);' +
                
                'if (isLeonardoUrl && !hasSubdomainPrefix) {' +
                    'const path = urlObj.pathname;' +
                    'const search = urlObj.search;' +
                    'const newUrl = window.location.protocol + "//" + window.location.host + "/" + subdomain + CONFIG.subdomainMarker + path + search;' +
                    'return newUrl;' +
                '}' +
                
                '// For relative URLs, only rewrite if they look like Leonardo.ai resources' +
                'if (!urlObj.hostname || urlObj.hostname === window.location.hostname) {' +
                    '// This is a relative URL or same-domain URL' +
                    'if (urlObj.pathname.startsWith("/") && !urlObj.pathname.includes(CONFIG.subdomainMarker)) {' +
                        'const newUrl = window.location.protocol + "//" + window.location.host + "/" + subdomain + CONFIG.subdomainMarker + urlObj.pathname + urlObj.search;' +
                        'return newUrl;' +
                    '}' +
                '}' +
                
                '// Skip all other external domains completely' +
                'if (urlObj.hostname && urlObj.hostname !== window.location.hostname) {' +
                    'return url;' +
                '}' +
            '} catch (e) {' +
                'return url;' +
            '}' +
            
            'return url;' +
        '}' +
        
        'const originalCreateElement = document.createElement;' +
        'document.createElement = function(tagName) {' +
            'const element = originalCreateElement.call(this, tagName);' +
            'if (tagName.toLowerCase() === "script") {' +
                'const originalSetAttribute = element.setAttribute;' +
                'element.setAttribute = function(name, value) {' +
                    'if (name === "src") {' +
                        'value = rewriteUrl(value);' +
                    '}' +
                    'return originalSetAttribute.call(this, name, value);' +
                '};' +
            '}' +
            'return element;' +
        '};' +
        
        'const originalSetAttribute = Element.prototype.setAttribute;' +
        'Element.prototype.setAttribute = function(name, value) {' +
            'if (name === "src" && this.tagName.toLowerCase() === "script") {' +
                'value = rewriteUrl(value);' +
            '}' +
            'return originalSetAttribute.call(this, name, value);' +
        '};' +
        
        'const observer = new MutationObserver(function(mutations) {' +
            'mutations.forEach(function(mutation) {' +
                'mutation.addedNodes.forEach(function(node) {' +
                    'if (node.nodeType === Node.ELEMENT_NODE) {' +
                        'if (node.tagName === "SCRIPT" && node.src) {' +
                            'node.src = rewriteUrl(node.src);' +
                        '}' +
                        'const scripts = node.querySelectorAll ? node.querySelectorAll("script[src]") : [];' +
                        'scripts.forEach(function(script) {' +
                            'script.src = rewriteUrl(script.src);' +
                        '});' +
                    '}' +
                '});' +
            '});' +
        '});' +
        
        'observer.observe(document, { childList: true, subtree: true });' +
        
        '// Immediately override fetch to catch any requests made during script execution' +
        'const originalFetch = window.fetch;' +
        'window.fetch = function(url, options = {}) {' +
            'const rewrittenUrl = rewriteUrl(url);' +
            'return originalFetch.call(this, rewrittenUrl, options);' +
        '};' +
        
        '// Immediately override XMLHttpRequest' +
        'const originalOpen = XMLHttpRequest.prototype.open;' +
        'XMLHttpRequest.prototype.open = function(method, url, ...args) {' +
            'const rewrittenUrl = rewriteUrl(url);' +
            'return originalOpen.call(this, method, rewrittenUrl, ...args);' +
        '};' +
        
    '})();';
}

module.exports = { createClientRequestInterceptor }; 