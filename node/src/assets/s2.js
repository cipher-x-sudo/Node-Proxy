// To use a custom base URL for rewriting, set window.s2BaseUrl before loading this script:
// Example:
// <script>window.s2BaseUrl = "https://dummy.example.com";</script>
// <script src="/assets/s2.js"></script>

(function() {
  // Allow user to define a base URL for rewriting; fallback to browser URL
  var baseUrl = (typeof window.s2BaseUrl === 'string' && window.s2BaseUrl) ? window.s2BaseUrl : window.location.origin;
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  window.s2ActiveBaseUrl = baseUrl;

  // Allow user to define the target domain (e.g., 'leonardo.ai')
  var targetDomain = (typeof window.s2TargetDomain === 'string' && window.s2TargetDomain) ? window.s2TargetDomain : null;
  if (!targetDomain) {
    // Try to infer from config if injected, fallback to 'example.com'
    if (window.proxyConfig && window.proxyConfig.targetDomain) {
      targetDomain = window.proxyConfig.targetDomain;
    } else {
      targetDomain = 'example.com'; // fallback default
    }
  }

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

  // Helper: get target domain for current page
  function getTargetDomain() {
    var host = window.location.host;
    var sub = getSubdomain(host, getProxyRoot(host, targetDomain));
    if (sub) return sub + '.' + targetDomain;
    return targetDomain;
  }

  function absolutizeUrl(relUrl) {
    if (/^(https?:)?\/\//.test(relUrl)) {
      // If it's already an absolute URL, check if it's to the target domain and rewrite to proxy if needed
      var url = new URL(relUrl, window.location.origin);
      var tDomain = getTargetDomain();
      if (url.hostname.endsWith(targetDomain)) {
        // Rewrite to proxy domain
        var sub = getSubdomain(url.hostname, targetDomain);
        var proxyHost = sub ? sub + '.' + getProxyRoot(window.location.host, targetDomain) : getProxyRoot(window.location.host, targetDomain);
        url.hostname = proxyHost;
        return url.toString();
      }
      return relUrl;
    }
    // Relative URL: rewrite to proxy domain
    var sub = getSubdomain(window.location.host, getProxyRoot(window.location.host, targetDomain));
    var proxyHost = sub ? sub + '.' + getProxyRoot(window.location.host, targetDomain) : getProxyRoot(window.location.host, targetDomain);
    return window.location.protocol + '//' + proxyHost + relUrl;
  }

  function reloadTag(el) {
    var parent = el.parentNode;
    if (!parent) return;
    var next = el.nextSibling;
    parent.removeChild(el);
    var clone = el.cloneNode(true);
    if (next) {
      parent.insertBefore(clone, next);
    } else {
      parent.appendChild(clone);
    }
  }

  function replaceScriptTag(oldScript, newSrc) {
    var newScript = document.createElement('script');
    // Copy all attributes except src
    for (var i = 0; i < oldScript.attributes.length; i++) {
      var attr = oldScript.attributes[i];
      if (attr.name !== 'src') {
        newScript.setAttribute(attr.name, attr.value);
      }
    }
    newScript.src = newSrc;
    if (oldScript.async) newScript.async = true;
    if (oldScript.defer) newScript.defer = true;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  }

  function rewriteTags() {
    document.querySelectorAll('script[src]').forEach(function(el) {
      var oldSrc = el.getAttribute('src');
      var newSrc = absolutizeUrl(oldSrc);
      if (oldSrc !== newSrc) {
        replaceScriptTag(el, newSrc);
      }
    });
    document.querySelectorAll('link[href]').forEach(function(el) {
      var oldHref = el.getAttribute('href');
      var newHref = absolutizeUrl(oldHref);
      if (oldHref !== newHref) {
        el.setAttribute('href', newHref);
        reloadTag(el);
      }
    });
    document.querySelectorAll('img[src]').forEach(function(el) {
      var oldSrc = el.getAttribute('src');
      var newSrc = absolutizeUrl(oldSrc);
      if (oldSrc !== newSrc) {
        el.setAttribute('src', newSrc);
        reloadTag(el);
      }
    });
    document.querySelectorAll('img[srcset]').forEach(function(el) {
      var oldSrcset = el.getAttribute('srcset');
      if (!oldSrcset) return;
      var newSrcset = oldSrcset.split(',').map(function(part) {
        var trimmed = part.trim();
        var spaceIdx = trimmed.indexOf(' ');
        var url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        var descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
        var newUrl = absolutizeUrl(url);
        return newUrl + descriptor;
      }).join(', ');
      if (oldSrcset !== newSrcset) {
        el.setAttribute('srcset', newSrcset);
        reloadTag(el);
      }
    });
  }

  function observeBodyWhenReady() {
    if (document.body) {
      var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.addedNodes) {
            mutation.addedNodes.forEach(function(node) {
              if (node.nodeType === 1) {
                if (node.matches && (node.matches('script[src]') || node.matches('link[href]') || node.matches('img[src]') || node.matches('img[srcset]'))) {
                  rewriteTags();
                } else if (node.querySelectorAll) {
                  node.querySelectorAll('script[src],link[href],img[src],img[srcset]').forEach(function(el) {
                    rewriteTags();
                  });
                }
              }
            });
          }
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      setTimeout(observeBodyWhenReady, 50);
    }
  }

  rewriteTags();
  observeBodyWhenReady();
  setInterval(rewriteTags, 1000);
})(); 