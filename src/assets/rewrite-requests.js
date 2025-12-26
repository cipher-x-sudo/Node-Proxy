(function() {
  const config = window.proxyConfig || {};
  const targetDomain = config.targetDomain || 'leonardo.ai';
  const proxyDomain = config.proxyDomain || window.location.host;
  const additionalDomains = config.additionalDomains || [];
  const noRewriteDomains = config.noRewriteDomains || [];
  const skipRewriteDomains = config.skipRewriteDomains || [];
  const noCredentialsDomains = config.noCredentialsDomains || [];

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

      if (noRewriteDomains.includes(parsed.hostname)) {
        // Replace proxy domain in the path with target domain
        const proxyDomainPattern = new RegExp(config.proxyDomain.replace(/\./g, '\\.'), 'g');
        parsed.pathname = parsed.pathname.replace(proxyDomainPattern, targetDomain);
        return parsed.toString();
      }

      // If the hostname is in skipRewriteDomains, do not rewrite
      if (skipRewriteDomains.includes(parsed.hostname)) {
        return url;
      }

      if (shouldRewriteHost(parsed.hostname)) {
        // For target domain: preserve subdomain
        if (parsed.hostname === targetDomain || parsed.hostname.endsWith('.' + targetDomain)) {
          const sub = getSubdomain(parsed.hostname, targetDomain);
          const newHost = sub ? `${sub}.${proxyDomain}` : proxyDomain;
          parsed.host = newHost;
          return parsed.toString();
        }
        // For additional domains: preserve subdomain logic if needed, or just return as is
        // (No more /proxy-external rewrite)
        return url;
      }
      
      // For external domains: if path contains proxy domain, replace with target domain
      // This fixes cases where the server generated URLs with the proxy domain in the path
      const baseProxyDomain = proxyDomain.split(':')[0]; // Remove port if present
      if (parsed.pathname.includes(baseProxyDomain) || parsed.search.includes(baseProxyDomain) || parsed.hash.includes(baseProxyDomain)) {
        const proxyDomainPattern = new RegExp(baseProxyDomain.replace(/\./g, '\\.'), 'g');
        parsed.pathname = parsed.pathname.replace(proxyDomainPattern, targetDomain);
        parsed.search = parsed.search.replace(proxyDomainPattern, targetDomain);
        parsed.hash = parsed.hash.replace(proxyDomainPattern, targetDomain);
        return parsed.toString();
      }
      
      // For all other (external) domains, do not rewrite
      return url;
    } catch {
      return url;
    }
  }

  function isNoCredentialsDomain(url) {
    try {
      const parsed = new URL(url);
      return noCredentialsDomains.some(domain => {
        // Exact match
        if (parsed.hostname === domain) return true;
        // Subdomain match (e.g., consent-eu.cookiefirst.com matches cookiefirst.com)
        // Check if hostname ends with the domain (as subdomain or exact match)
        const domainParts = domain.split('.');
        const hostnameParts = parsed.hostname.split('.');
        // Check if the last N parts of hostname match the domain parts
        if (hostnameParts.length >= domainParts.length) {
          const hostnameSuffix = hostnameParts.slice(-domainParts.length).join('.');
          if (hostnameSuffix === domain) return true;
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    init = init || {};
    let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    url = rewriteUrl(url);
    if (!isNoCredentialsDomain(url)) {
      init.credentials = 'include';
    } else {
      delete init.credentials;
    }
    if (typeof input === 'string') {
      input = url;
    } else if (input && input.url) {
      input = new Request(url, input);
    }
    return origFetch.call(this, input, init);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    const rewrittenUrl = rewriteUrl(url);
    if (!isNoCredentialsDomain(rewrittenUrl)) {
      this.withCredentials = true;
    } else {
      this.withCredentials = false;
    }
    return origOpen.call(this, method, rewrittenUrl, ...args);
  };

  console.log('[rewrite-requests.js] Outgoing requests rewritten with external domain support');
})();