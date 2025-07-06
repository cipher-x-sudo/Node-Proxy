// Server-side URL Rewriter Utility
// Rewrites all matching URLs in an HTML string (no skipping)

function rewriteHtmlUrls(html, config) {
    if (!html || !config) return html;
    const domainPattern = config.targetDomain.replace(/\./g, '\\.');
    // Match http(s)://subdomain.targetDomain
    const urlRegex = new RegExp(`(https?:\/\/)([a-z0-9-]+)\\.${domainPattern}`, 'gi');
    // Replace with proxy domain and subdomain marker
    const replacement = function(match, proto, subdomain) {
        const rewritten = `${proto}${config.proxyDomain}/${subdomain}${config.subdomainMarker}`;
        console.log(`[SERVER REWRITE] Found: ${match} | Rewriting to: ${rewritten} | Reason: always rewrite`);
        return rewritten;
    };
    return html.replace(urlRegex, replacement);
}

module.exports = { rewriteHtmlUrls }; 