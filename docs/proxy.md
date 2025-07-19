# src/proxy.js - Detailed Documentation

This file implements the main reverse proxy logic for the project. It uses Express for HTTP handling, Puppeteer for browser automation, and manages cookies, CORS, script injection, and both API and static resource proxying. Below is a line-by-line breakdown and explanation.

---

```js
const express = require('express');
```
*Imports the Express framework for creating the HTTP server.*

```js
const puppeteer = require('puppeteer');
```
*Imports Puppeteer for headless browser automation, used for advanced proxying or scraping.*

```js
const fs = require('fs');
const path = require('path');
```
*Imports Node.js modules for file system and path operations.*

```js
const config = require('./config');
```
*Imports the central configuration file.*

```js
const http = require('http');
const https = require('https');
```
*Imports HTTP and HTTPS modules for making outgoing requests.*

```js
const cheerio = require('cheerio');
```
*Imports Cheerio for server-side HTML parsing and manipulation (used for script injection).* 

```js
const app = express();
const PORT = process.env.PORT || 3000;
```
*Creates the Express app and sets the port (default 3000).* 

```js
const COLORS = {
  request: '\x1b[36m',
  proxy: '\x1b[35m',
  puppeteer: '\x1b[32m',
  navigation: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};
```
*Defines color codes for console logging, for easier debugging.*

```js
let browserPromise = puppeteer.launch({
  args: config.proxyEnabled ? [
    `--proxy-server=${config.httpProxy.host}:${config.httpProxy.port}`
  ] : [],
  headless: 'new',
});
```
*Launches a Puppeteer browser instance, optionally using a proxy if enabled in config.*

```js
const cookieFiles = fs.readdirSync(process.cwd()).filter(f => f.startsWith('cookies') && f.endsWith('.json'));
const globalCookies = [];
for (const file of cookieFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) globalCookies.push(...data);
  } catch {}
}
```
*Loads all cookies from files named cookies*.json in the current directory, merging them into a single array for use in requests.*

```js
if (require.main === module) {
  console.log(`\x1b[33m[COOKIES] Loaded ${cookieFiles.length} file(s), ${globalCookies.length} cookies\x1b[0m`);
}
```
*Logs the number of loaded cookie files and cookies if this script is run directly.*

```js
app.use('/assets', express.static(path.join(__dirname, 'assets')));
```
*Serves static assets (client-side scripts) from the assets directory.*

---

## CORS Preflight Handling

```js
app.options(/.*/, (req, res) => {
  const origin = req.headers.origin;
  
  const allowedOrigins = [
    'https://app.localhost:3000',
    'http://app.localhost:3000',
    'https://localhost:3000',
    'http://localhost:3000'
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
  } else if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
  }

  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    res.set('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,baggage,sentry-trace');
  }

  res.set('Access-Control-Max-Age', '86400');

  res.status(204).end();
});
```
*Handles CORS preflight (OPTIONS) requests, setting appropriate headers for allowed origins, methods, and headers.*

---

## Helper Functions

### parseSubdomainFromHost
```js
function parseSubdomainFromHost(host, rootDomain) {
  if (!host || !rootDomain) return null;
  const parts = host.split('.');
  const rootParts = rootDomain.split('.');
  if (parts.length > rootParts.length) {
    return parts.slice(0, parts.length - rootParts.length).join('.');
  }
  return null;
}
```
*Extracts the subdomain from a host, given a root domain. Returns null if none.*

### injectScripts
```js
function injectScripts(html) {
  const configScript = `<script>window.proxyConfig = ${JSON.stringify({
    proxyDomain: config.proxyDomain,
    targetDomain: config.targetDomain,
    tags: config.tagsToOverride,
    attributes: config.attributesToOverride,
    skipRewriteDomains: config.skipRewriteDomains,
    noCredentialsDomains: config.noCredentialsDomains
  })};</script>`;
  const rewriteRequestsTag = '<script src="/assets/rewrite-requests.js"></script>';
  let s1Tag = '';
  if (config.injectS1) {
    s1Tag = '<script src="/assets/s1.js"></script>';
  }
  const $ = cheerio.load(html, { decodeEntities: false });
  $('head').prepend(`\n${configScript}\n${rewriteRequestsTag}\n${s1Tag}\n`);
  return $.html();
}
```
*Injects configuration and client-side scripts into the HTML head. Optionally injects s1.js if enabled in config.*

---

## Proxying Logic

### isApiRequest
```js
function isApiRequest(targetUrl) {
  return targetUrl.includes('api.leonardo.ai');
}
```
*Determines if a URL is an API request that should be handled differently.*

### proxyResource
```js
function proxyResource(targetUrl, req, res) {
  // ...
}
```
*Handles proxying of resources. If the target is an API, it uses special logic to forward the request and set CORS headers. For other resources, it merges cookies, rewrites headers, and proxies the request, handling credentials and referer/origin rewriting as needed. Logs success or failure for each request.*

---

## Static Resource Detection

```js
function isStaticResource(path) {
  return (
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|ogg|mp3|json|map)$/i.test(path) ||
    path.includes('/_next/static/') ||
    // ...
  );
}
```
*Detects if a request is for a static resource (by file extension or path).* 

---

## Main Request Handler (Lines 183+)

```js
app.use(async (req, res) => {
  console.log(`${COLORS.request}[REQUEST] ${req.method} ${req.originalUrl}${COLORS.reset}`);
  const rootDomain = config.proxyDomain;
  const host = req.hostname || req.headers.host;
  const subdomain = parseSubdomainFromHost(host, rootDomain);
  const cleanPath = req.path;
  let targetUrl;
  
  if (subdomain) {
    targetUrl = `https://${subdomain}.${config.targetDomain}${cleanPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    console.log(`${COLORS.proxy}[PROXY] Subdomain: ${subdomain} | CleanPath: ${cleanPath} | Target: ${targetUrl}${COLORS.reset}`);
  } else {
    targetUrl = `https://${config.targetDomain}${cleanPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    console.log(`${COLORS.proxy}[PROXY] No subdomain | CleanPath: ${cleanPath} | Target: ${targetUrl}${COLORS.reset}`);
  }

  const staticResource = isStaticResource(cleanPath);
  const accept = req.headers.accept || '';

  // NEW: Handle API requests immediately
  if (isApiRequest(targetUrl)) {
    proxyResource(targetUrl, req, res);
    return;
  }

  if (!staticResource && accept.includes('text/html')) {
    const browser = await browserPromise;
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);
    
    if (globalCookies.length) {
      try {
        await page.setCookie(...globalCookies);
        console.log(COLORS.puppeteer + '[PUPPETEER] Cookies set for page' + COLORS.reset);
      } catch (e) {
        console.log(COLORS.error + '[ERROR] Failed to set cookies for page: ' + e.message + COLORS.reset);
      }
    }
    
    console.log(`${COLORS.navigation}[PUPPETEER] Navigating to ${targetUrl}${COLORS.reset}`);

    if (config.proxyEnabled && config.httpProxy.username && config.httpProxy.password) {
      await page.authenticate({
        username: config.httpProxy.username,
        password: config.httpProxy.password
      });
    }

    const extraHeaders = { ...req.headers };
    delete extraHeaders.host;
    if (extraHeaders.referer) {
      extraHeaders.referer = extraHeaders.referer.replace(config.proxyDomain, config.targetDomain);
    }
    await page.setExtraHTTPHeaders(extraHeaders);

    let navigationError = null;
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (err) {
      navigationError = err;
      console.log(`${COLORS.error}[ERROR] Puppeteer navigation error for ${targetUrl}: ${err.message}${COLORS.reset}`);
    }

    if (navigationError) {
      res.status(502).send('Failed to load resource: ' + navigationError.message);
      await page.close();
      return;
    }

    const contentType = await page.evaluate(() => document.contentType);
    let body = await page.content();
    body = injectScripts(body);
    
    res.set('Content-Type', 'text/html');
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Content-Security-Policy', "default-src 'self' https: 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' https: *;");
    
    console.log(`${COLORS.puppeteer}[PUPPETEER] Served HTML with injected scripts for ${targetUrl}${COLORS.reset}`);
    res.status(200).send(body);
    await page.close();
  } else {
    proxyResource(targetUrl, req, res);
    return;
  }
});
```
*This is the main request handler for all incoming requests. It determines the target URL based on the subdomain, checks if the request is for an API or static resource, and either proxies the request directly or uses Puppeteer to render and inject scripts into HTML responses. Handles cookies, authentication, and sets security headers.*

---

## Module Export

```js
module.exports = app;
```
*Exports the Express app for use elsewhere or for testing.*

---

## Standalone Server & Graceful Shutdown

```js
if (require.main === module) {
  const fs = require('fs');
  const certPath = path.join(__dirname, 'cert.pem');
  const keyPath = path.join(__dirname, 'key.pem');
  
  const shutdown = async () => {
    console.log('\nShutting down gracefully...');
    try {
      const browser = await browserPromise;
      await browser.close();
      console.log('Browser closed');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`Proxy server running with HTTPS on https://localhost:${PORT}`);
    });
  } else {
    app.listen(PORT, () => {
      console.log(`Proxy server running on http://localhost:${PORT}`);
    });
  }
}
```
*If the file is run directly, this block sets up graceful shutdown handlers for SIGINT/SIGTERM, closes the Puppeteer browser on exit, and starts the server. If SSL certificates are present, it runs with HTTPS; otherwise, it falls back to HTTP.*

---

## Additional Details
- **Subdomain Handling:** The proxy rewrites subdomains from the proxy domain to the target domain, allowing seamless access to subdomains of the target through the proxy.
- **Puppeteer Usage:** For HTML requests, Puppeteer is used to render the page, set cookies, and inject scripts, ensuring the proxied site works as if accessed directly.
- **Security:** Sets CORS and Content Security Policy headers to allow cross-origin requests and safe script execution.
- **Shutdown:** Ensures the browser instance is closed cleanly on process exit.

---

**If you need even more granular detail (e.g., every single line or variable), let me know!** 