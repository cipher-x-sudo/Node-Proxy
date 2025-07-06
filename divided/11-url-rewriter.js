// URL Rewriter Script - Injected separately
(function() {
    "use strict";
    
    console.log("[URL REWRITER] Script starting...");
    
    // Configuration from server
    const CONFIG = window.proxyConfig || {
        proxyDomain: "leonardo.anon404.me",
        targetDomain: "leonardo.ai",
        subdomainMarker: "-leonardo-ai",
        tags: ["img", "link", "script", "iframe"],
        attributes: ["href", "src", "content"]
    };
    
    console.log("[URL REWRITER] Config loaded:", CONFIG);
    
    // List of external domains to skip
    const skipDomains = [
        "consent.cookiefirst.com",
        "cdn.jsdelivr.net",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "google-analytics.com",
        "googletagmanager.com",
        "clarity.ms",
        "js.stripe.com",
        "r.wdfl.co",
        "www.googletagmanager.com"
    ];
    
    // Track processed elements to prevent infinite loops
    const processedElements = new WeakSet();
    
    function parseAndRewriteUrl(urlString) {
        try {
            const url = new URL(urlString, window.location.origin);
            if (url.protocol !== "https:" && url.protocol !== "http:") return urlString;
            // Skip external domains
            if (skipDomains.some(domain => url.hostname.includes(domain))) return urlString;
            const hostname = url.hostname;
            const domainParts = hostname.split(".");
            if (domainParts.length < 2) return urlString;
            const targetDomain = CONFIG.targetDomain;
            const isTargetDomain = hostname.endsWith("." + targetDomain) || hostname === targetDomain;
            if (!isTargetDomain) return urlString;
            let subdomain = "app";
            if (domainParts.length > 2) subdomain = domainParts[0];
            const newHostname = CONFIG.proxyDomain;
            const newPath = "/" + subdomain + CONFIG.subdomainMarker + url.pathname + url.search;
            const newUrl = url.protocol + "//" + newHostname + newPath;
            // Only log successful rewrites
            if (newUrl !== urlString) {
                console.log("%c[URL REWRITE] %c" + urlString + " → " + newUrl, "color: #0066ff; font-weight: bold;", "color: #0066ff;");
            }
            fetch("/__debug_log", { 
                method: "POST", 
                body: JSON.stringify({ 
                    type: "url_rewrite", 
                    from: urlString, 
                    to: newUrl 
                }) 
            }).catch(() => {});
            return newUrl;
        } catch (e) {
            return urlString;
        }
    }

    function replaceAttributes(el) {
        if (processedElements.has(el)) return;
        CONFIG.attributes.forEach(attr => {
            if(el[attr]) {
                let newVal = el[attr];
                const rewrittenUrl = parseAndRewriteUrl(newVal);
                if(rewrittenUrl !== newVal) {
                    const fileName = el.tagName.toLowerCase() + "[" + attr + "]";
                    console.log("%c[FILE REWRITE] %c" + fileName + " → " + rewrittenUrl, "color: #0066ff; font-weight: bold;", "color: #0066ff;");
                    fetch("/__debug_log", { 
                        method: "POST", 
                        body: JSON.stringify({ 
                            type: "file_rewrite", 
                            element: fileName, 
                            from: newVal, 
                            to: rewrittenUrl 
                        }) 
                    }).catch(() => {});
                    el[attr] = rewrittenUrl;
                    processedElements.add(el);
                }
            }
        });
    }

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes) {
                mutation.addedNodes.forEach(node => {
                    if(node.nodeType === 1) {
                        const selector = CONFIG.tags.map(t => 
                            CONFIG.attributes.map(a => `${t}[${a}]`).join(",")
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
        CONFIG.attributes.map(a => `${t}[${a}]`).join(",")
    ).join(",");
    document.querySelectorAll(selector).forEach(replaceAttributes);

    // Fallback interval
    setInterval(() => {
        document.querySelectorAll(selector).forEach(replaceAttributes);
    }, 1000);
    
    console.log("[URL REWRITER] URL rewriting system initialized successfully!");
})();