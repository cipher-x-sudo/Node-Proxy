/* Client rewriting: helpers, fetch/XHR rewrite, DOM (s1) and static tags (s2). */
(function() {
  if (!window.proxyConfig) return;
  var c = window.proxyConfig;
  var targetDomain = c.targetDomain || 'leonardo.ai';
  var proxyDomain = c.proxyDomain || window.location.host;
  var additionalDomains = c.additionalDomains || [];
  var noRewriteDomains = c.noRewriteDomains || [];
  var skipRewriteDomains = c.skipRewriteDomains || [];
  var noCredentialsDomains = c.noCredentialsDomains || [];
  var cookiefirstDomains = c.cookiefirstDomains || [];
  var linkedinDomain = c.linkedinDomain || 'linkedin.com';
  var tags = c.tags || c.tagsToOverride || ['img', 'link', 'script', 'iframe'];
  var attributes = c.attributes || c.attributesToOverride || ['href', 'src', 'content'];
  var injectS1 = c.injectS1 || false;

  function getSubdomain(host, rootDomain) {
    var parts = host.split('.');
    var rootParts = rootDomain.split('.');
    if (parts.length > rootParts.length) return parts.slice(0, parts.length - rootParts.length).join('.');
    return null;
  }

  function getProxyRoot(host, rootDomain) {
    var parts = host.split('.');
    var rootParts = rootDomain.split('.');
    if (parts.length > rootParts.length) return parts.slice(parts.length - rootParts.length).join('.');
    return host;
  }

  function replaceProxyDomainInString(str, proxyDom, targetDom) {
    var baseProxy = (proxyDom || '').split(':')[0];
    var baseTarget = (targetDom || '').split(':')[0];
    var domainParts = baseProxy.split('.');
    if (domainParts.length >= 2) {
      var basePattern = domainParts.slice(-2).join('\\.');
      var regex = new RegExp('([a-zA-Z0-9-]+\\.)?' + basePattern, 'g');
      return str.replace(regex, function(match) {
        var m = match.match(/^([a-zA-Z0-9-]+)\./);
        return m ? m[1] + '.' + baseTarget : baseTarget;
      });
    }
    return str.replace(new RegExp(baseProxy.replace(/\./g, '\\.'), 'g'), baseTarget);
  }

  function shouldRewriteHost(hostname) {
    if (!hostname || !targetDomain) return false;
    if (hostname === targetDomain || hostname.endsWith('.' + targetDomain)) return true;
    for (var i = 0; i < additionalDomains.length; i++)
      if (hostname === additionalDomains[i] || hostname.endsWith('.' + additionalDomains[i])) return true;
    return false;
  }

  function isCookiefirstDomain(hostname) {
    for (var i = 0; i < cookiefirstDomains.length; i++) {
      var d = cookiefirstDomains[i];
      if (hostname === d) return true;
      var dp = d.split('.');
      var hp = hostname.split('.');
      if (hp.length >= dp.length && hp.slice(-dp.length).join('.') === d) return true;
    }
    return false;
  }

  function isLinkedInDomain(hostname) {
    return hostname === linkedinDomain || hostname.endsWith('.' + linkedinDomain);
  }

  function isNoCredentialsDomain(url) {
    try {
      var parsed = new URL(url);
      for (var i = 0; i < noCredentialsDomains.length; i++) {
        var d = noCredentialsDomains[i];
        if (parsed.hostname === d) return true;
        var dp = d.split('.');
        var hp = parsed.hostname.split('.');
        if (hp.length >= dp.length && hp.slice(-dp.length).join('.') === d) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  function absolutizeUrl(relUrl) {
    var proxyHost = window.location.host;
    var proxyRoot = getProxyRoot(proxyHost, targetDomain);
    if (/^(https?:)?\/\//.test(relUrl)) {
      var url = new URL(relUrl, window.location.origin);
      if (url.hostname === targetDomain || url.hostname.endsWith('.' + targetDomain)) {
        var sub = getSubdomain(url.hostname, targetDomain);
        url.hostname = sub ? sub + '.' + proxyRoot : proxyRoot;
        return url.toString();
      }
      return relUrl;
    }
    var sub = getSubdomain(proxyHost, proxyRoot);
    return window.location.protocol + '//' + (sub ? sub + '.' + proxyRoot : proxyRoot) + relUrl;
  }

  function rewriteUrl(url) {
    try {
      var parsed = new URL(url);
      if (noRewriteDomains.indexOf(parsed.hostname) !== -1) {
        parsed.pathname = parsed.pathname.replace(new RegExp((c.proxyDomain || proxyDomain).replace(/\./g, '\\.'), 'g'), targetDomain);
        return parsed.toString();
      }
      if (isCookiefirstDomain(parsed.hostname)) {
        parsed.pathname = replaceProxyDomainInString(parsed.pathname, proxyDomain, targetDomain);
        return parsed.toString();
      }
      if (isLinkedInDomain(parsed.hostname)) {
        parsed.pathname = replaceProxyDomainInString(parsed.pathname, proxyDomain, targetDomain);
        if (parsed.search) {
          parsed.searchParams.forEach(function(value, key) {
            var v = decodeURIComponent(value);
            var nv = replaceProxyDomainInString(v, proxyDomain, targetDomain);
            if (nv !== v) parsed.searchParams.set(key, nv);
          });
          parsed.search = replaceProxyDomainInString(parsed.search, proxyDomain, targetDomain);
        }
        return parsed.toString();
      }
      if (skipRewriteDomains.indexOf(parsed.hostname) !== -1) return url;
      if (shouldRewriteHost(parsed.hostname) && (parsed.hostname === targetDomain || parsed.hostname.endsWith('.' + targetDomain))) {
        var s = getSubdomain(parsed.hostname, targetDomain);
        parsed.host = s ? s + '.' + proxyDomain.split(':')[0] : proxyDomain.split(':')[0];
        return parsed.toString();
      }
      return url;
    } catch (e) { return url; }
  }

  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    url = rewriteUrl(url);
    if (!isNoCredentialsDomain(url)) init.credentials = 'include';
    else delete init.credentials;
    if (typeof input === 'string') input = url;
    else if (input && input.url) input = new Request(url, input);
    return origFetch.call(this, input, init);
  };

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments, 2);
    var rewritten = rewriteUrl(url);
    this.withCredentials = !isNoCredentialsDomain(rewritten);
    return origOpen.apply(this, [method, rewritten].concat(args));
  };

  if (injectS1) {
    var selector = tags.map(function(t) { return attributes.map(function(a) { return t + '[' + a + ']'; }).join(','); }).join(',');
    function rewriteElement(el) {
      for (var i = 0; i < attributes.length; i++) {
        var attr = attributes[i];
        if (el[attr] && typeof el[attr] === 'string') {
          var ov = el[attr];
          var nv = absolutizeUrl(ov);
          if (ov !== nv) el[attr] = nv;
        }
      }
    }
    document.querySelectorAll(selector).forEach(rewriteElement);
    var obs1 = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.addedNodes) m.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) {
            if (node.querySelectorAll) node.querySelectorAll(selector).forEach(rewriteElement);
            rewriteElement(node);
          }
        });
        if (m.type === 'attributes' && attributes.indexOf(m.attributeName) !== -1) rewriteElement(m.target);
      });
    });
    obs1.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: attributes });
    setInterval(function() { document.querySelectorAll(selector).forEach(rewriteElement); }, 1000);
  }

  function reloadTag(el) {
    var parent = el.parentNode;
    if (!parent) return;
    var next = el.nextSibling;
    parent.removeChild(el);
    var clone = el.cloneNode(true);
    if (next) parent.insertBefore(clone, next);
    else parent.appendChild(clone);
  }

  function replaceScriptTag(oldScript, newSrc) {
    var newScript = document.createElement('script');
    for (var i = 0; i < oldScript.attributes.length; i++) {
      var attr = oldScript.attributes[i];
      if (attr.name !== 'src') newScript.setAttribute(attr.name, attr.value);
    }
    newScript.src = newSrc;
    if (oldScript.async) newScript.async = true;
    if (oldScript.defer) newScript.defer = true;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  }

  function rewriteStaticTags() {
    document.querySelectorAll('script[src]').forEach(function(el) {
      var os = el.getAttribute('src');
      var ns = absolutizeUrl(os);
      if (os !== ns) replaceScriptTag(el, ns);
    });
    document.querySelectorAll('link[href]').forEach(function(el) {
      var oh = el.getAttribute('href');
      var nh = absolutizeUrl(oh);
      if (oh !== nh) { el.setAttribute('href', nh); reloadTag(el); }
    });
    document.querySelectorAll('img[src]').forEach(function(el) {
      var os = el.getAttribute('src');
      var ns = absolutizeUrl(os);
      if (os !== ns) { el.setAttribute('src', ns); reloadTag(el); }
    });
    document.querySelectorAll('img[srcset]').forEach(function(el) {
      var oss = el.getAttribute('srcset');
      if (!oss) return;
      var nss = oss.split(',').map(function(part) {
        var t = part.trim();
        var idx = t.indexOf(' ');
        var u = idx === -1 ? t : t.slice(0, idx);
        var desc = idx === -1 ? '' : t.slice(idx);
        return absolutizeUrl(u) + desc;
      }).join(', ');
      if (oss !== nss) { el.setAttribute('srcset', nss); reloadTag(el); }
    });
  }

  function observeBody() {
    if (document.body) {
      var obs2 = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          if (m.addedNodes) m.addedNodes.forEach(function(node) {
            if (node.nodeType === 1 && (node.matches && (node.matches('script[src]') || node.matches('link[href]') || node.matches('img[src]') || node.matches('img[srcset]')) || node.querySelectorAll))
              rewriteStaticTags();
          });
        });
      });
      obs2.observe(document.body, { childList: true, subtree: true });
    } else setTimeout(observeBody, 50);
  }

  rewriteStaticTags();
  observeBody();
  setInterval(rewriteStaticTags, 1000);
})();
