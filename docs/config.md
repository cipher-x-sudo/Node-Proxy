# src/config.js - Detailed Documentation

This file contains the configuration for the Puppeteer reverse proxy, including domains, proxy settings, user agent, and rewrite rules.

---

```js
// Configuration for Puppeteer Reverse Proxy
```
*Comment describing the purpose of the file.*

```js
module.exports = {
```
*Exports the configuration object for use in other files.*

```js
  proxyDomain: 'localhost:3000', // Your proxy domain
```
*The domain on which the proxy will be accessible.*

```js
  targetDomain: 'leonardo.ai',   // The real target domain
```
*The actual domain that the proxy will forward requests to.*

```js
  tagsToOverride: ['img', 'link', 'script', 'iframe'],
```
*HTML tags whose attributes will be rewritten by the proxy/client scripts.*

```js
  attributesToOverride: ['href', 'src', 'content'],
```
*Attributes of the above tags that will be rewritten.*

```js
  proxyEnabled: true,                // Set to true to use an HTTP proxy
```
*Whether to use an HTTP proxy for outgoing requests (used by Puppeteer).*

```js
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
```
*The user agent string to use for browser automation and outgoing requests.*

```js
  httpProxy: {
    host: '86.109.93.239',
    port: 12323,
    username: 'huzaifaphan',
    password: 'huzaifaphan'
  },
```
*Settings for the HTTP proxy (host, port, username, password) if proxying is enabled.*

```js
  // New option to enable/disable rewriting of static elements
  rewriteStatic: false,
```
*Whether to rewrite static elements (e.g., images, scripts) or not.*

```js
  // New option to enable/disable injection of s1.js
  injectS1: false,
```
*Whether to inject the s1.js script into proxied pages.*

```js
  skipRewriteDomains: [
    'consent.cookiefirst.com'
    
  ],
```
*Domains for which URL rewriting should be skipped.*

```js
  // Domains for which credentials (cookies, etc) should NOT be sent
  noCredentialsDomains: [
    'app.launchdarkly.com',
    'events.launchdarkly.com',
    'c.adora-cdn.com',
    'consent.cookiefirst.com',
    'api.leonardo.ai'
  ]
```
*Domains for which cookies and credentials should not be sent in requests.*

```js
};
```
*End of the configuration object.*

---

**Summary:**
- This file centralizes all configuration for the proxy, making it easy to adjust domains, proxy settings, and rewrite rules as needed. 