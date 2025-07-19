(function(){
    if (!window.proxyConfig) return;
    console.log('[s1.js] Proxy client-side rewrite script loaded and running.');
    const config = window.proxyConfig;

    // Helper: get subdomain from host
    function getSubdomain(host, rootDomain) {
        var parts = host.split('.');
        var rootParts = rootDomain.split('.');
        if (parts.length > rootParts.length) return parts.slice(0, parts.length - rootParts.length).join('.');
        return null;
    }
    // Helper: get proxy root domain
    function getProxyRoot(host, rootDomain) {
        var parts = host.split('.');
        var rootParts = rootDomain.split('.');
        if (parts.length > rootParts.length) return parts.slice(parts.length - rootParts.length).join('.');
        return host;
    }
    // Helper: get target domain
    function getTargetDomain() {
        if (window.proxyConfig && window.proxyConfig.targetDomain) {
            return window.proxyConfig.targetDomain;
        }
        return 'example.com';
    }
    // Helper: absolutize and rewrite URLs
    function absolutizeUrl(relUrl) {
        var targetDomain = getTargetDomain();
        if (/^(https?:)?\/\//.test(relUrl)) {
            // If it's already an absolute URL, check if it's to the target domain and rewrite to proxy if needed
            var url = new URL(relUrl, window.location.origin);
            if (url.hostname.endsWith(targetDomain)) {
                var sub = getSubdomain(url.hostname, targetDomain);
                var proxyHost = sub ? sub + '.' + getProxyRoot(window.location.host, targetDomain) : getProxyRoot(window.location.host, targetDomain);
                url.hostname = proxyHost;
                return url.toString();
            }
            return relUrl;
        }
        // Relative URL: rewrite to proxy domain
        var sub = getSubdomain(window.location.host, getProxyRoot(window.location.host, getTargetDomain()));
        var proxyHost = sub ? sub + '.' + getProxyRoot(window.location.host, getTargetDomain()) : getProxyRoot(window.location.host, getTargetDomain());
        return window.location.protocol + '//' + proxyHost + relUrl;
    }

    function rewriteElement(el) {
        config.attributes.forEach(attr => {
            if (el[attr] && typeof el[attr] === 'string') {
                var oldVal = el[attr];
                var newVal = absolutizeUrl(oldVal);
                if (oldVal !== newVal) {
                    el[attr] = newVal;
                }
            }
        });
    }
    // Initial rewrite
    const selector = config.tags.map(t => config.attributes.map(a => `${t}[${a}]`).join(',')).join(',');
    document.querySelectorAll(selector).forEach(rewriteElement);
    // Observe for new elements
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes) {
                mutation.addedNodes.forEach(node => {
                    if(node.nodeType === 1) {
                        Array.from(node.querySelectorAll(selector)).forEach(rewriteElement);
                        rewriteElement(node);
                    }
                });
            }
            if (mutation.type === 'attributes' && config.attributes.includes(mutation.attributeName)) {
                rewriteElement(mutation.target);
            }
        });
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: config.attributes
    });
    // Fallback interval
    setInterval(() => {
        document.querySelectorAll(selector).forEach(rewriteElement);
    }, 1000);
})();