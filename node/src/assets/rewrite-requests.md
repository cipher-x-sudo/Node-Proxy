# rewrite-requests.js

## Overview

`rewrite-requests.js` is a client-side JavaScript utility that transparently rewrites outgoing API and resource requests (made via `fetch` and `XMLHttpRequest`) so they are routed through your reverse proxy. This is especially useful for setups with wildcard subdomains and when you want to ensure all requests to your target domain go through your proxy infrastructure.

---

## Purpose
- Intercepts all outgoing `fetch` and `XMLHttpRequest` requests from the browser.
- Rewrites requests to your target domain (e.g., `leonardo.ai`) so they are sent to the corresponding proxy subdomain (e.g., `app.leonardo.anon404.me`).
- Ensures CORS preflight (OPTIONS) requests are also routed through the proxy.
- Preserves subdomains, so requests to `api.leonardo.ai` become `api.leonardo.anon404.me`.

---

## How It Works
- Patches the global `window.fetch` and `XMLHttpRequest.prototype.open` methods.
- For each outgoing request, checks if the URL's hostname matches the configured target domain.
- If so, rewrites the hostname to the current proxy domain, preserving any subdomain.
- Leaves all other requests unchanged.

---

## Configuration
- **`window.rewriteRequestsTargetDomain`** (string, optional): Set this to your target domain (e.g., `leonardo.ai`) before loading the script.
- If not set, the script will try to use `window.proxyConfig.targetDomain` (if available).
- If neither is set, defaults to `example.com`.

### Example Configuration
```html
<script>
  window.rewriteRequestsTargetDomain = "leonardo.ai";
</script>
<script src="/assets/rewrite-requests.js"></script>
```

---

## What Does It Rewrite?
- **All outgoing `fetch` and `XMLHttpRequest` requests** whose URL hostname ends with the target domain.
- **Preserves subdomains:**
  - `https://api.leonardo.ai/v1/graphql` → `https://api.leonardo.anon404.me/v1/graphql` (if your proxy is on `anon404.me`)
  - `https://leonardo.ai/foo` → `https://leonardo.anon404.me/foo`
- **Does NOT rewrite:**
  - Requests to other domains (e.g., `https://cdn.example.com/asset.js`)
  - Relative URLs (e.g., `/api/foo`)—these are sent as-is to the current origin.

---

## Examples

### 1. fetch
**Before:**
```js
fetch('https://api.leonardo.ai/v1/graphql', { ... });
```
**After rewrite (on https://app.leonardo.anon404.me):**
```js
fetch('https://api.leonardo.anon404.me/v1/graphql', { ... });
```

### 2. XMLHttpRequest
**Before:**
```js
var xhr = new XMLHttpRequest();
xhr.open('POST', 'https://leonardo.ai/foo');
xhr.send();
```
**After rewrite (on https://app.leonardo.anon404.me):**
```js
// Internally, the request is sent to:
// https://leonardo.anon404.me/foo
```

### 3. Preflight (OPTIONS) Requests
- When you make a cross-origin request with custom headers or methods, the browser automatically sends a preflight OPTIONS request to the rewritten URL (e.g., `https://api.leonardo.anon404.me/v1/graphql`).
- Your proxy must handle CORS for these requests.

---

## Notes
- This script does **not** rewrite URLs in HTML attributes (use `s1.js` or `s2.js` for that).
- It only affects requests made via `fetch` and `XMLHttpRequest`.
- It is safe to use alongside `s1.js` and `s2.js`.
- For best results, set the target domain before loading the script.

---

## Troubleshooting
- If requests are not being rewritten, ensure `window.rewriteRequestsTargetDomain` is set **before** the script loads.
- If you see CORS errors, make sure your proxy server is configured to handle CORS for all relevant routes and methods. 