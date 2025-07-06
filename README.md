# Divided Proxy Structure

This directory contains the proxy code divided into logical modules for better organization and maintainability.

## File Structure

### Core Files
- **`01-proxy-server.js`** - Main server file that orchestrates everything
- **`02-utilities.js`** - Helper functions and utilities
- **`03-browser-manager.js`** - Puppeteer browser initialization and management
- **`04-cookie-manager.js`** - Cookie loading and management
- **`05-request-handlers.js`** - Request processing logic (HTML vs non-HTML)
- **`06-url-utils.js`** - URL manipulation and subdomain detection
- **`07-session-manager.js`** - Session ID generation and management
- **`10-rewrite-interceptor.js`** - Combined client-side URL rewriting and modal manipulation logic (injected into browser)
- **`11-url-rewriter.js`** - Standalone client-side URL rewriter (injected or used for debugging)
- **`12-modal-manipulator.js`** - Standalone client-side modal content manipulator
- **`14-server-url-rewriter.js`** - Server-side HTML URL rewriting utility

## Proxy Configuration

### Residential Proxy Setup

The system supports residential proxies (like iproyal) for enhanced anonymity. To configure your proxy:

1. **Edit `config.js`** and update the proxy settings:
```javascript
proxy: {
    enabled: true,
    host: "your-proxy-host.here", // Your iproyal proxy host
    port: 8080, // Your proxy port
    username: "your-username", // Your proxy username
    password: "your-password"  // Your proxy password
}
```

2. **Test your proxy connection**:
```bash
node test-proxy.js
```

3. **Start the proxy server**:
```bash
node 01-proxy-server.js
```

### Proxy Features

- **Authentication**: Automatic proxy authentication using `page.authenticate()`
- **Connection Testing**: Built-in proxy connection testing before browser launch
- **Fallback**: System continues with proxy even if initial test fails
- **Logging**: Detailed logging of proxy connection status

## URL Rewriting & DOM Manipulation

The proxy now uses a robust, modular approach for URL rewriting and DOM manipulation:
- **Client-Side**: `10-rewrite-interceptor.js` is injected into browser pages to rewrite Leonardo.ai URLs and manipulate modal content. It uses a config-driven approach with `tags` and `attributes` arrays to target specific elements and attributes.
- **Server-Side**: `14-server-url-rewriter.js` rewrites Leonardo.ai URLs in HTML responses as a fallback or for debugging.
- **Skip Logic**: Both client and server logic skip rewriting for known external domains and URLs already containing the proxy domain, preventing infinite loops and external breakage.
- **Debugging**: Only successful rewrites are logged, with color-coded logs in both browser and server consoles. A visual indicator and server endpoint for debug logs are available.

## Configuration Format

The config file (`config.js`) now uses arrays for tags and attributes:
```javascript
module.exports = {
    proxyDomain: "leonardo.anon404.me",
    targetDomain: "leonardo.ai",
    subdomainMarker: "-leonardo-ai",
    tags: ["img", "link", "script", "iframe"],
    attributes: ["href", "src", "content"],
    // ...proxy settings...
};
```

## The Problem

The main issue was that JavaScript code in the browser was making requests to wrong URLs:
- **Wrong**: `/.well-known/vercel/security/static/challenge.v2.min.js`
- **Correct**: `/app-leonardo-ai/.well-known/vercel/security/static/challenge.v2.min.js`

## Current Solution

The system now uses both client-side and server-side URL rewriting:
- **Client-side**: Injected scripts rewrite Leonardo.ai URLs in the DOM and intercept requests before they are sent.
- **Server-side**: HTML responses are rewritten as a fallback using `14-server-url-rewriter.js`.
- **Legacy HTML body rewriting and duplicate logic have been removed.**
- **All rewriting is now config-driven and robust against external domains.** 