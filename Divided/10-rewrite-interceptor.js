// Combined URL rewriting and DOM manipulation interceptor
// This script handles both URL rewriting and modal content manipulation

function createRewriteInterceptor(config) {
    const configJson = JSON.stringify(config);
    
    return '(function(){' +
        '"use strict";' +
        'console.log("[REWRITE INTERCEPTOR] Script starting...");' +
        'const CONFIG = ' + configJson + ';' +
        'console.log("[REWRITE INTERCEPTOR] Initializing with config:", CONFIG);' +
        'console.log("[REWRITE INTERCEPTOR] DOM ready, setting up observers...");' +
        
        // URL Rewriting Logic
        'function setupUrlRewriting() {' +
            '// Track processed elements to prevent infinite loops' +
            'const processedElements = new WeakSet();' +
            
            'function parseAndRewriteUrl(urlString) {' +
                'try {' +
                    '// Parse URL properly' +
                    'const url = new URL(urlString, window.location.origin);' +
                    
                    '// Check protocol first' +
                    'if (url.protocol !== "https:" && url.protocol !== "http:") {' +
                        'return urlString;' +
                    '}' +
                    
                    '// Extract domain parts' +
                    'const hostname = url.hostname;' +
                    'const domainParts = hostname.split(".");' +
                    
                    '// Must have at least 2 parts (subdomain.domain or domain.tld)' +
                    'if (domainParts.length < 2) {' +
                        'return urlString;' +
                    '}' +
                    
                    '// Check if this is the target domain we want to rewrite' +
                    'const targetDomain = CONFIG.targetDomain;' +
                    'const isTargetDomain = hostname.endsWith("." + targetDomain) || hostname === targetDomain;' +
                    
                    'if (!isTargetDomain) {' +
                        'return urlString;' +
                    '}' +
                    
                    '// Extract subdomain if present' +
                    'let subdomain = "app";' +
                    'if (domainParts.length > 2) {' +
                        'subdomain = domainParts[0];' +
                    '}' +
                    
                    '// Build new URL with proxy domain' +
                    'const newHostname = CONFIG.proxyDomain;' +
                    'const newPath = "/" + subdomain + CONFIG.subdomainMarker + url.pathname + url.search;' +
                    'const newUrl = url.protocol + "//" + newHostname + newPath;' +
                    
                    '// Log URL rewriting with bright green color' +
                    'console.log("%c[URL REWRITE] %c" + urlString + " → " + newUrl, "color: #00ff00; font-weight: bold;", "color: #00ff00;");' +
                    
                    '// Also send to server for logging' +
                    'fetch("/__debug_log", { method: "POST", body: JSON.stringify({ type: "url_rewrite", from: urlString, to: newUrl }) }).catch(() => {});' +
                    
                    'return newUrl;' +
                '} catch (e) {' +
                    '// If URL parsing fails, return original' +
                    'return urlString;' +
                '}' +
            '}' +
            
            'function replaceAttributes(el) {' +
                '// Skip if already processed to prevent infinite loops' +
                'if (processedElements.has(el)) {' +
                    'return;' +
                '}' +
                
                'CONFIG.attributes.forEach(attr => {' +
                    'if(el[attr]) {' +
                        'let newVal = el[attr];' +
                        
                        '// Debug: Log all elements being checked' +
                        'console.log("[DEBUG] Checking element:", el.tagName, "attr:", attr, "value:", newVal);' +
                        
                        '// Skip if URL already contains proxy domain to prevent infinite rewriting' +
                        'if (newVal.includes(CONFIG.proxyDomain)) {' +
                            'console.log("[DEBUG] Skipping - already contains proxy domain");' +
                            'return;' +
                        '}' +
                        
                        '// Skip external domains that should never be rewritten' +
                        'const externalDomains = [' +
                            '"consent.cookiefirst.com",' +
                            '"cdn.jsdelivr.net",' +
                            '"fonts.googleapis.com",' +
                            '"fonts.gstatic.com",' +
                            '"google-analytics.com",' +
                            '"googletagmanager.com",' +
                            '"facebook.com",' +
                            '"twitter.com",' +
                            '"linkedin.com"' +
                        '];' +
                        
                        '// Quick check for consent.cookiefirst.com to prevent any rewriting' +
                        'if (newVal.includes("consent.cookiefirst.com")) {' +
                            'console.log("[DEBUG] Skipping - consent.cookiefirst.com");' +
                            'return;' +
                        '}' +
                        
                        'try {' +
                            'const url = new URL(newVal, window.location.origin);' +
                            'const isExternal = externalDomains.some(domain => url.hostname.includes(domain));' +
                            'if (isExternal) {' +
                                'console.log("[DEBUG] Skipping - external domain:", url.hostname);' +
                                'return;' +
                            '}' +
                        '} catch (e) {' +
                            '// If URL parsing fails, continue with rewriting' +
                        '}' +
                        
                        '// Use proper URL parsing and rewriting' +
                        'const rewrittenUrl = parseAndRewriteUrl(newVal);' +
                        'if(rewrittenUrl !== newVal) {' +
                            '// Log the file being rewritten with bright green color' +
                            'const fileName = el.tagName.toLowerCase() + "[" + attr + "]";' +
                            'console.log("%c[FILE REWRITE] %c" + fileName + " → " + rewrittenUrl, "color: #00ff00; font-weight: bold;", "color: #00ff00;");' +
                            '// Also send to server for logging' +
                            'fetch("/__debug_log", { method: "POST", body: JSON.stringify({ type: "file_rewrite", element: fileName, from: newVal, to: rewrittenUrl }) }).catch(() => {});' +
                            'el[attr] = rewrittenUrl;' +
                            '// Mark as processed' +
                            'processedElements.add(el);' +
                        '} else {' +
                            'console.log("[DEBUG] No rewrite needed for:", newVal);' +
                        '}' +
                    '}' +
                '});' +
            '}' +
            
            'const observer = new MutationObserver(mutations => {' +
                'mutations.forEach(mutation => {' +
                    'if (mutation.addedNodes) {' +
                        'mutation.addedNodes.forEach(node => {' +
                            'if(node.nodeType === 1) {' +
                                'const selector = CONFIG.tags.map(t => ' +
                                    'CONFIG.attributes.map(a => `${t}[${a}]`).join(",")' +
                                ').join(",");' +
                                'Array.from(node.querySelectorAll(selector)).forEach(replaceAttributes);' +
                                'replaceAttributes(node);' +
                            '}' +
                        '});' +
                    '}' +
                    'if (mutation.type === "attributes" && CONFIG.attributes.includes(mutation.attributeName)) {' +
                        'replaceAttributes(mutation.target);' +
                    '}' +
                '});' +
            '});' +
            
            'observer.observe(document.documentElement, {' +
                'childList: true,' +
                'subtree: true,' +
                'attributes: true,' +
                'attributeFilter: CONFIG.attributes' +
            '});' +
            
            '// Initial replacement' +
            'const selector = CONFIG.tags.map(t => ' +
                'CONFIG.attributes.map(a => `${t}[${a}]`).join(",")' +
            ').join(",");' +
            'document.querySelectorAll(selector).forEach(replaceAttributes);' +
            
            '// Fallback interval' +
            'setInterval(() => {' +
                'document.querySelectorAll(selector).forEach(replaceAttributes);' +
            '}, 1000);' +
        '}' +
        
        // Modal Content Manipulation Logic
        'function setupModalManipulation() {' +
            'const handleModalContent = () => {' +
                'const observer = new MutationObserver((mutations) => {' +
                    'mutations.forEach((mutation) => {' +
                        'if (!mutation.addedNodes) return;' +
                        
                        'mutation.addedNodes.forEach((node) => {' +
                            '// Check for various modal structures' +
                            'const modalSelectors = [' +
                                '".ant-modal-content",' +
                                '".modal-content",' +
                                '".dialog-content",' +
                                '"[role=\\"dialog\\"]",' +
                                '".popup-content"' +
                            '];' +
                            
                            'let modalContent = null;' +
                            'for (const selector of modalSelectors) {' +
                                'modalContent = node.querySelector?.(selector) || ' +
                                              'node.parentElement?.querySelector(selector);' +
                                'if (modalContent) break;' +
                            '}' +
                            
                            'if (modalContent) {' +
                                '// Try different modal body selectors' +
                                'const bodySelectors = [".ant-modal-body", ".modal-body", ".dialog-body"];' +
                                'let modalBody = null;' +
                                'for (const selector of bodySelectors) {' +
                                    'modalBody = modalContent.querySelector(selector);' +
                                    'if (modalBody) break;' +
                                '}' +
                                
                                'if (modalBody) {' +
                                    '// Target the specific div structure' +
                                    'const containerDiv = modalBody.querySelector("div > div");' +
                                    'if (containerDiv) {' +
                                        '// Get all direct child divs of the container' +
                                        'const targetDivs = containerDiv.querySelectorAll(":scope > div");' +
                                        'if (targetDivs.length >= 4) {' +
                                            '// Remove divs 3 and 4 (zero-based index 2 and 3)' +
                                            'targetDivs[3]?.remove(); // 4th div' +
                                            'targetDivs[2]?.remove(); // 3rd div' +
                                        '}' +
                                    '}' +
                                '}' +
                            '}' +
                        '});' +
                    '});' +
                '});' +
                
                'observer.observe(document.body, {' +
                    'childList: true,' +
                    'subtree: true' +
                '});' +
                
                'return observer;' +
            '};' +
            
            '// Event delegation for button clicks' +
            'document.addEventListener("click", (e) => {' +
                'if (e.target.closest("div")) {' +
                    '// Start observing with cleanup' +
                    'const modalObserver = handleModalContent();' +
                    'setTimeout(() => modalObserver.disconnect(), 5000);' +
                '}' +
            '});' +
        '}' +
        
        // Initialize both systems
        'setupUrlRewriting();' +
        'setupModalManipulation();' +
        'console.log("[REWRITE INTERCEPTOR] All systems initialized successfully!");' +
        
        // Test and visual indicator
        'setTimeout(() => {' +
            'const testElements = document.querySelectorAll("script[src], img[src], link[href]");' +
            'console.log("[DEBUG] Found", testElements.length, "elements to check for rewriting");' +
            'testElements.forEach((el, i) => {' +
                'console.log("[DEBUG] Element", i + 1, ":", el.tagName, el.src || el.href);' +
            '});' +
            
            '// Add visual indicator to page' +
            'const indicator = document.createElement("div");' +
            'indicator.style.cssText = "position:fixed;top:10px;right:10px;background:#00ff00;color:#000;padding:10px;border-radius:5px;z-index:9999;font-family:monospace;font-size:12px;";' +
            'indicator.innerHTML = "REWRITE INTERCEPTOR ACTIVE<br>Elements: " + testElements.length + "<br>Rewrites: 0";' +
            'document.body.appendChild(indicator);' +
            
            '// Track rewrite count' +
            'window.rewriteCount = 0;' +
            'const originalFetch = window.fetch;' +
            'window.fetch = function(url, options) {' +
                'if (url && typeof url === "string" && url.includes("leonardo.ai")) {' +
                    'window.rewriteCount++;' +
                    'indicator.innerHTML = "REWRITE INTERCEPTOR ACTIVE<br>Elements: " + testElements.length + "<br>Rewrites: " + window.rewriteCount;' +
                '}' +
                'return originalFetch.apply(this, arguments);' +
            '};' +
            
            '// Test current page URL' +
            'console.log("[TEST] Current page URL:", window.location.href);' +
            'console.log("[TEST] Current hostname:", window.location.hostname);' +
            'if (window.location.hostname.includes("leonardo.anon404.me")) {' +
                'console.log("[TEST] ✅ Proxy domain detected - interceptor is working!");' +
                'indicator.style.background = "#00ff00";' +
            '} else {' +
                'console.log("[TEST] ❌ Proxy domain not detected");' +
                'indicator.style.background = "#ff0000";' +
            '}' +
            
            '// Update indicator every 5 seconds' +
            'setInterval(() => {' +
                'const currentElements = document.querySelectorAll("script[src], img[src], link[href]");' +
                'indicator.innerHTML = "REWRITE INTERCEPTOR ACTIVE<br>Elements: " + currentElements.length + "<br>Rewrites: " + (window.rewriteCount || 0) + "<br>Time: " + new Date().toLocaleTimeString();' +
            '}, 5000);' +
        '}, 1000);' +
        
    '})();';
}

module.exports = { createRewriteInterceptor }; 