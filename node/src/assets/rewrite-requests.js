(function() {
  const config = window.proxyConfig || {};
  const targetDomain = config.targetDomain || 'leonardo.ai';
  const proxyDomain = config.proxyDomain || window.location.host;
  const additionalDomains = config.additionalDomains || [];

  function getSubdomain(host, rootDomain) {
    const parts = host.split('.');
    const rootParts = rootDomain.split('.');
    if (parts.length > rootParts.length) return parts.slice(0, parts.length - rootParts.length).join('.');
    return null;
  }

  function shouldRewriteHost(hostname) {
    // Check if hostname is target domain or subdomain
    if (hostname === targetDomain || hostname.endsWith('.' + targetDomain)) {
      return true;
    }
    
    // Check if hostname is in additional domains list
    for (const domain of additionalDomains) {
      // Match exact domain or any subdomain
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }
    
    return false;
  }

  function rewriteUrl(url) {
    try {
      const parsed = new URL(url);
      
      if (shouldRewriteHost(parsed.hostname)) {
        // For target domain: preserve subdomain
        if (parsed.hostname === targetDomain || parsed.hostname.endsWith('.' + targetDomain)) {
          const sub = getSubdomain(parsed.hostname, targetDomain);
          const newHost = sub ? `${sub}.${proxyDomain}` : proxyDomain;
          parsed.host = newHost;
          return parsed.toString();
        }
        // For additional domains: rewrite to proxy domain with special path
        const newPath = `/proxy-external/${parsed.hostname}${parsed.pathname}`;
        return `https://${proxyDomain}${newPath}${parsed.search}`;
      }
      return url;
    } catch {
      return url;
    }
  }

  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    init = init || {};
    init.credentials = 'include';
    
    if (typeof input === 'string') {
      input = rewriteUrl(input);
    } else if (input && input.url) {
      input = new Request(rewriteUrl(input.url), input);
    }
    return origFetch.call(this, input, init);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this.withCredentials = true;
    const rewrittenUrl = rewriteUrl(url);
    return origOpen.call(this, method, rewrittenUrl, ...args);
  };

  console.log('[rewrite-requests.js] Outgoing requests rewritten with external domain support');
})();