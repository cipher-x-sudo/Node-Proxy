# Puppeteer Reverse Proxy with URL Rewriting

## Table of Contents

- [config.js](#configjs)
- [proxy.js](#proxyjs)
- [HTTPS Support](#https-support)

---

## config.js

> [`node/src/config.js`](node/src/config.js)

| Line | Description |
|------|-------------|
| 1    | File header: Configuration for Puppeteer Reverse Proxy |
| 3-15 | Exported configuration object for the proxy. |
| 4    | `proxyDomain`: The domain your proxy will use (e.g., hailuo.anon404.me). |
| 5    | `targetDomain`: The real target domain to proxy (e.g., hailuoai.video). |
| 6    | `subdomainMarker`: Marker for subdomain in path (e.g., -hailuoai-video). |
| 7    | `tagsToOverride`: HTML tags whose attributes will be rewritten (e.g., img, link, script, iframe). |
| 8    | `attributesToOverride`: HTML attributes to rewrite (e.g., href, src, content). |
| 9    | `proxyEnabled`: Whether to use an HTTP proxy for outgoing requests. |
| 10   | `userAgent`: The User-Agent string to use for requests. |
| 11-14| `httpProxy`: HTTP proxy settings (host, port, username, password). |
| 15   | End of exported config object. |

---

## proxy.js

> [`node/src/proxy.js`](node/src/proxy.js)

| Line(s) | Description |
|---------|-------------|
| 1-2     | File header and reference to README for documentation. |
| 4       | Import Express for HTTP server. |
| 5       | Import Puppeteer for headless browsing. |
| 6       | Import fs for file system operations (reading cookies/assets). |
| 7       | Import path for path utilities. |
| 8       | Import config from config.js. |
| 9       | Import https for HTTPS server support. |
| 11      | Create Express app instance. |
| 12      | Set default port (from env or 3000). |
| 14-23   | `parseTarget`: Helper function to extract subdomain and clean path from request URL. Uses regex based on config.subdomainMarker. |
| 25-28   | If match found, return subdomain and cleanPath. |
| 29      | If no match, return null subdomain and original path. |
| 32-36   | `buildTargetUrl`: Helper to construct the real target URL from subdomain, path, and query. |
| 39-48   | `loadCookies`: Helper to load cookies from all cookies*.json files in the working directory. |
| 50-60   | `injectScripts`: Helper to inject s1.js and s2.js (and proxyConfig) into the HTML <head>. Reads assets and inserts after <head>. |
| 62-78   | `rewriteHtml`: Helper to rewrite URLs in HTML body. Rewrites absolute URLs to target domain and relative URLs to proxy domain. |
| 81-125  | Main proxy route: Handles all requests. |
| 82      | Parse subdomain and cleanPath from request. |
| 83      | Build target URL using helpers. |
| 86-92   | Launch Puppeteer browser. Use proxy if enabled in config. |
| 93      | Open new page in browser. |
| 94      | Set User-Agent from config. |
| 97-99   | Set cookies in browser if available. |
| 102-108 | Authenticate to HTTP proxy if needed. |
| 111-115 | Forward headers from client, adjusting host and referer for target. |
| 118     | Navigate to target URL with Puppeteer. Wait for network idle. |
| 121     | Get content type from the loaded page. |
| 124     | Get HTML content from the page. |
| 127-133 | If content is HTML, rewrite and inject scripts, set content-type. |
| 134-140 | If not HTML, send screenshot as fallback (for binary resources). |
| 143-145 | Set CORS and security headers. |
| 147     | Send final response and close browser. |
| 150     | Export Express app for use in server.js. |
| 153-165 | If run directly, start HTTPS server if certs are present, otherwise HTTP. |

---

## HTTPS Support

When running `proxy.js` directly, the server will automatically use HTTPS if the following files are present in `node/src`:

- `cert.pem` (certificate)
- `key.pem` (private key)

These are self-signed certificates generated for local development. If these files are missing, the server will fall back to HTTP.

### How to Trust the Self-Signed Certificate

- When you visit `https://localhost:3000` in your browser, you may see a security warning.
- You can proceed ("Advanced" > "Proceed to localhost") to use the proxy for local development.
- For a trusted experience, you can import `cert.pem` into your system/browser's trusted root certificates (not recommended for production).

---

## [Back to top](#table-of-contents) 