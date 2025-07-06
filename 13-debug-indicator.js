// Debug Indicator Script - Injected separately
(function() {
    "use strict";
    
    console.log("[DEBUG INDICATOR] Script starting...");
    
    // Wait for DOM to be ready
    setTimeout(() => {
        const testElements = document.querySelectorAll("script[src], img[src], link[href]");
        console.log("[DEBUG] Found", testElements.length, "elements to check for rewriting");
        testElements.forEach((el, i) => {
            console.log("[DEBUG] Element", i + 1, ":", el.tagName, el.src || el.href);
        });
        
        // Add visual indicator to page
        const indicator = document.createElement("div");
        indicator.style.cssText = "position:fixed;top:10px;right:10px;background:#00ff00;color:#000;padding:10px;border-radius:5px;z-index:9999;font-family:monospace;font-size:12px;";
        indicator.innerHTML = "REWRITE INTERCEPTOR ACTIVE<br>Elements: " + testElements.length + "<br>Rewrites: 0";
        document.body.appendChild(indicator);
        
        // Track rewrite count
        window.rewriteCount = 0;
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
            if (url && typeof url === "string" && url.includes("leonardo.ai")) {
                window.rewriteCount++;
                indicator.innerHTML = "REWRITE INTERCEPTOR ACTIVE<br>Elements: " + testElements.length + "<br>Rewrites: " + window.rewriteCount;
            }
            return originalFetch.apply(this, arguments);
        };
        
        // Test current page URL
        console.log("[TEST] Current page URL:", window.location.href);
        console.log("[TEST] Current hostname:", window.location.hostname);
        if (window.location.hostname.includes("leonardo.anon404.me")) {
            console.log("[TEST] ✅ Proxy domain detected - interceptor is working!");
            indicator.style.background = "#00ff00";
        } else {
            console.log("[TEST] ❌ Proxy domain not detected");
            indicator.style.background = "#ff0000";
        }
        
        // Update indicator every 5 seconds
        setInterval(() => {
            const currentElements = document.querySelectorAll("script[src], img[src], link[href]");
            indicator.innerHTML = "REWRITE INTERCEPTOR ACTIVE<br>Elements: " + currentElements.length + "<br>Rewrites: " + (window.rewriteCount || 0) + "<br>Time: " + new Date().toLocaleTimeString();
        }, 5000);
        
        console.log("[DEBUG INDICATOR] Debug indicator initialized successfully!");
    }, 1000);
})(); 