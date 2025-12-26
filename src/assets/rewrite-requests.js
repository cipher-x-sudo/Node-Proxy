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

  function isCookiefirstDomain(hostname) {
    // Check if hostname is cookiefirst.com or any subdomain
    const cookiefirstDomains = ['cookiefirst.com', 'consent.cookiefirst.com', 'consent-eu.cookiefirst.com'];
    for (const domain of cookiefirstDomains) {
      if (hostname === domain) return true;
      // Check subdomain match
      const domainParts = domain.split('.');
      const hostnameParts = hostname.split('.');
      if (hostnameParts.length >= domainParts.length) {
        const hostnameSuffix = hostnameParts.slice(-domainParts.length).join('.');
        if (hostnameSuffix === domain) return true;
      }
    }
    return false;
  }

  function isLinkedInDomain(hostname) {
    // Check if hostname is linkedin.com or any subdomain
    return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
  }

  function replaceProxyDomainInString(str, proxyDomain, targetDomain) {
    // Replace proxy domain with target domain in a string (handles both encoded and unencoded)
    // Also handle subdomains (e.g., app.hostme360.tech -> app.leonardo.ai)
    const baseProxyDomain = proxyDomain.split(':')[0]; // Remove port if present
    const baseTargetDomain = targetDomain.split(':')[0]; // Remove port if present
    
    // Match the base domain or any subdomain of it
    // Pattern: (subdomain.)?baseDomain
    const domainParts = baseProxyDomain.split('.');
    if (domainParts.length >= 2) {
      // Match any subdomain pattern like app.hostme360.tech, api.hostme360.tech, etc.
      const basePattern = domainParts.slice(-2).join('\\.'); // e.g., hostme360\.tech
      const subdomainPattern = `([a-zA-Z0-9-]+\\.)?${basePattern}`;
      const regex = new RegExp(subdomainPattern, 'g');
      
      return str.replace(regex, (match) => {
        // Extract subdomain if present
        const subdomainMatch = match.match(/^([a-zA-Z0-9-]+)\./);
        if (subdomainMatch) {
          const subdomain = subdomainMatch[1];
          return `${subdomain}.${baseTargetDomain}`;
        }
        return baseTargetDomain;
      });
    }
    
    // Fallback to simple replacement
    const proxyDomainPattern = new RegExp(baseProxyDomain.replace(/\./g, '\\.'), 'g');
    return str.replace(proxyDomainPattern, baseTargetDomain);
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

      // Check cookiefirst.com and linkedin.com FIRST (before skipRewriteDomains)
      // because we need to rewrite paths even if domain is in skipRewriteDomains
      
      // Check if URL is for cookiefirst.com - replace proxy domain in path with target domain
      if (isCookiefirstDomain(parsed.hostname)) {
        // Replace proxy domain in the path with target domain
        parsed.pathname = replaceProxyDomainInString(parsed.pathname, proxyDomain, targetDomain);
        return parsed.toString();
      }

      // Check if URL is for linkedin.com - replace proxy domain in path and query params with target domain
      if (isLinkedInDomain(parsed.hostname)) {
        // Replace proxy domain in the path with target domain
        parsed.pathname = replaceProxyDomainInString(parsed.pathname, proxyDomain, targetDomain);
        // Replace proxy domain in query parameters
        if (parsed.search) {
          // Work with searchParams to handle URL-encoded values properly
          parsed.searchParams.forEach((value, key) => {
            // Decode the value, replace proxy domain, then set it back
            const decodedValue = decodeURIComponent(value);
            const newValue = replaceProxyDomainInString(decodedValue, proxyDomain, targetDomain);
            if (newValue !== decodedValue) {
              parsed.searchParams.set(key, newValue);
            }
          });
          // Also replace in the raw search string for any edge cases
          parsed.search = replaceProxyDomainInString(parsed.search, proxyDomain, targetDomain);
        }
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