/**
 * Server-side rewriting helpers. Used by proxy.js only.
 */

function parseSubdomainFromHost(host, rootDomain) {
  if (!host || !rootDomain) return null;
  const hostWithoutPort = host.split(':')[0];
  const rootWithoutPort = rootDomain.split(':')[0];
  const parts = hostWithoutPort.split('.');
  const rootParts = rootWithoutPort.split('.');
  if (parts.length > rootParts.length) {
    return parts.slice(0, parts.length - rootParts.length).join('.');
  }
  return null;
}

/**
 * Rewrite referer from proxy domain to target domain for upstream requests.
 * Strips /a/:accountSlug from path if present.
 */
function rewriteRefererToTarget(refererUrl, proxyDomain, targetDomain, accountSlug) {
  try {
    const refUrl = new URL(refererUrl);
    const sub = parseSubdomainFromHost(refUrl.hostname, proxyDomain.split(':')[0]);
    const newHost = sub ? `${sub}.${targetDomain.split(':')[0]}` : targetDomain.split(':')[0];
    refUrl.hostname = newHost;
    if (accountSlug && refUrl.pathname.startsWith('/a/' + accountSlug + '/')) {
      refUrl.pathname = refUrl.pathname.slice(('/a/' + accountSlug).length) || '/';
    } else if (accountSlug && refUrl.pathname === '/a/' + accountSlug) {
      refUrl.pathname = '/';
    }
    return refUrl.toString();
  } catch {
    return `https://${targetDomain}/`;
  }
}

/**
 * Rewrite Location header from target domain to proxy domain (for 3xx responses).
 * Preserves account path prefix /a/:accountSlug.
 */
function rewriteLocationToProxy(redirectUrl, proxyDomain, targetDomain, accountSlug, req) {
  const protocol = (req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-ssl'] === 'on') ? 'https' : 'http';
  const baseProxyDomain = proxyDomain.split(':')[0];
  const sub = parseSubdomainFromHost(redirectUrl.hostname, targetDomain.split(':')[0]);
  const newHost = sub ? `${sub}.${baseProxyDomain}` : baseProxyDomain;
  const pathWithAccount = accountSlug ? '/a/' + accountSlug + (redirectUrl.pathname === '/' ? '' : redirectUrl.pathname) : redirectUrl.pathname;
  return `${protocol}://${newHost}${pathWithAccount}${redirectUrl.search}${redirectUrl.hash}`;
}

module.exports = {
  parseSubdomainFromHost,
  rewriteRefererToTarget,
  rewriteLocationToProxy,
};
