# Proxy Project Overview

## Project Purpose

This is a sophisticated web proxy system designed to handle Leonardo.ai subdomain routing and Vercel security challenges. It acts as an intermediary between client browsers and Leonardo.ai, managing session state, cookie handling, and security challenge resolution.

## Architecture Overview

The project is divided into modular components for maintainability and clarity:

```
Divided/
├── 01-proxy-server.js      # Main server orchestrator
├── 02-utilities.js         # Helper functions and utilities
├── 03-browser-manager.js   # Puppeteer browser management
├── 04-cookie-manager.js    # Cookie loading and management
├── 05-request-handlers.js  # Request processing logic
├── 06-url-utils.js         # URL manipulation and subdomain detection
├── 07-session-manager.js   # Session ID generation
├── 08-vercel-handler.js    # Vercel security challenge handling
├── 09-client-interceptor.js # (Legacy) Client-side request interception
├── 10-rewrite-interceptor.js # Combined client-side URL rewriting and modal manipulation
├── 11-url-rewriter.js      # Standalone client-side URL rewriter
├── 12-modal-manipulator.js # Standalone client-side modal manipulator
├── 14-server-url-rewriter.js # Server-side HTML URL rewriting utility
└── README.md              # Quick reference guide
```

## Detailed File Functionality

### 01-proxy-server.js - Main Server Orchestrator

**Purpose**: Central coordination point for the entire proxy system

**Key Functions**:
- **Express Server Setup**: Configures middleware (CORS, cookie parsing, security headers)
- **Request Routing**: Routes all incoming requests (`app.all('*')`)
- **Session Management**: Tracks browser sessions using session IDs
- **Subdomain Detection**: Determines target subdomain for requests
- **Request Classification**: Distinguishes between HTML and non-HTML requests
- **Server Lifecycle**: Handles startup, shutdown, and periodic maintenance

**Dependencies**: All other modules

**Critical Logic**:
```javascript
// Determines if request should use Puppeteer (HTML) or direct proxy (assets)
const isHtml = isHtmlRequest(req);
if (!isHtml) {
    await handleNonHtmlRequest(req, res, targetUrl, currentBrowserUrl, requestId);
} else {
    await handleHtmlRequest(req, res, targetUrl, sid, sessionPages, browser, allCookies, requestId);
}
```

### 02-utilities.js - Helper Functions and Utilities

**Purpose**: Common utility functions used across the application

**Key Functions**:
- **`getActivePageCount(sessionPages)`**: Returns number of active browser pages
- **`logPageCount(sessionPages)`**: Logs current page count with colored output
- **`cleanupInactivePages(sessionPages)`**: Removes broken/unresponsive pages
- **`debugLog(message, data)`**: Timestamped logging with optional data
- **`isStaticAsset(path)`**: Identifies static assets (CSS, JS, images, etc.)
- **`isHtmlRequest(req)`**: Determines if request should be handled by Puppeteer

**Static Asset Detection**:
```javascript
// Identifies files that should be proxied directly
return /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|otf|webp|mp4|webm|ogg|mp3|wav|m4a|json|xml|txt|map)(\?.*)?$/i.test(path);
```

### 03-browser-manager.js - Puppeteer Browser Management

**Purpose**: Manages the headless browser instance used for HTML rendering

**Key Functions**:
- **`initBrowser()`**: Creates and configures Puppeteer browser instance
- **Browser Configuration**: Sets up stealth mode, JavaScript, security settings

**Browser Settings**:
```javascript
browser = await puppeteer.launch({
    headless: 'new',
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--enable-javascript',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
    ]
});
```

### 04-cookie-manager.js - Cookie Loading and Management

**Purpose**: Handles loading and management of authentication cookies

**Key Functions**:
- **`loadCookies(allCookies)`**: Loads cookies from `cookies*.json` files
- **File Discovery**: Automatically finds all cookie files in working directory
- **Cookie Merging**: Combines cookies from multiple files into single array

**Cookie Loading Process**:
```javascript
// Finds all cookie files and loads them
const files = glob.sync('cookies*.json', { cwd: process.cwd() });
for (const file of files) {
    const cookiesData = JSON.parse(await fs.readFile(path.join(process.cwd(), file), 'utf8'));
    allCookies.push(...cookiesData);
}
```

### 05-request-handlers.js - Request Processing Logic

**Purpose**: Handles the two main types of requests (HTML vs non-HTML)

**Key Functions**:

#### `handleNonHtmlRequest(req, res, targetUrl, currentBrowserUrl, requestId)`
- **Direct Proxying**: Forwards static assets directly to target server
- **Header Management**: Filters and modifies request headers
- **Vercel Security Handling**: Special processing for security challenge requests
- **Response Forwarding**: Streams responses back to client

#### `handleHtmlRequest(req, res, targetUrl, sid, sessionPages, browser, allCookies, requestId)`
- **Page Management**: Creates or reuses Puppeteer pages per session
- **Cookie Injection**: Sets authentication cookies in browser
- **Request Interception**: Rewrites URLs for Vercel security endpoints
- **Page Navigation**: Handles page loading and content extraction
- **Challenge Detection**: Identifies and handles security challenge pages

**Request Interception Logic**:
```javascript
// Rewrites vercel/security URLs to include subdomain prefix
if (url.includes('vercel/security') && !url.includes('-leonardo-ai')) {
    const newUrl = `https://leonardo.anon404.me/${subdomain}-leonardo-ai${path}${urlObj.search}`;
    request.continue({ url: newUrl });
}
```

### 06-url-utils.js - URL Manipulation and Subdomain Detection

**Purpose**: Handles URL construction and subdomain inference

**Key Functions**:

#### `inferSubdomain(req, config, currentBrowserUrl)`
**Priority Order**:
1. **Current Browser URL**: Uses active page URL to determine subdomain
2. **Path-Based**: Extracts subdomain from URL path (`/app-leonardo-ai/...`)
3. **Referer Header**: Uses referer URL to determine subdomain

#### `getSubdomainFromSession(sid, sessionPages)`
- **Session Context**: Gets subdomain from current browser session
- **Page URL Analysis**: Extracts subdomain from active page URL

#### `getTargetUrl(req, config, currentBrowserUrl)`
- **URL Construction**: Builds target URLs with proper subdomain
- **Fallback Logic**: Uses config target domain if no subdomain found

**Subdomain Detection Logic**:
```javascript
// Extracts subdomain from various sources
const subMatch = url.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
if (subMatch) {
    return subMatch[1]; // Returns 'app', 'studio', etc.
}
```

### 07-session-manager.js - Session ID Generation

**Purpose**: Manages session identification for browser page tracking

**Key Functions**:
- **`getSessionId(req)`**: Generates or retrieves session ID from multiple sources

**Session ID Sources** (in priority order):
1. **Query Parameter**: `?sid=session123`
2. **Header**: `x-session-id: session123`
3. **Cookie**: `sid=session123`
4. **Generated**: Random string if none found

### 08-vercel-handler.js - Vercel Security Challenge Handling

**Purpose**: Centralized handling of all Vercel security challenge related functionality

**Key Functions**:

#### Request Detection
- **`isVercelSecurityRequest(req)`**: Identifies Vercel security requests
- **`isChallengeRequest(req)`**: Detects specific challenge request endpoints
- **`isWebAssemblyRequest(req)`**: Identifies WebAssembly file requests

#### Header Management
- **`setupVercelHeaders(req, filteredHeaders)`**: Sets proper headers for security requests
- **Content Type Handling**: Ensures correct content types for JSON and WebAssembly

#### Response Processing
- **`handleVercelResponse(req, res, assetRes, requestId)`**: Processes Vercel security responses
- **Header Forwarding**: Forwards all security-related headers
- **Challenge Response Logging**: Logs challenge responses for debugging

#### URL Rewriting
- **`createVercelRequestInterceptor(page, requestId)`**: Creates request interceptor for URL rewriting
- **`setupVercelRequestInterception(page, requestId)`**: Sets up Puppeteer request interception
- **Subdomain Detection**: Extracts subdomain from current page URL
- **URL Transformation**: Rewrites vercel/security URLs with proper subdomain prefix

#### Challenge Detection
- **`hasVercelChallenge(pageContent)`**: Detects challenge content in page HTML
- **`handleVercelChallengePage(page, requestId)`**: Processes challenge pages
- **Page Loading**: Ensures complete page loading for challenge execution

#### Logging
- **`logVercelChallenge(req, requestId)`**: Logs Vercel security challenge detection

**Vercel Security Handling Logic**:
```javascript
// Detects and handles various Vercel security request types
if (isVercelSecurityRequest(req)) {
    setupVercelHeaders(req, filteredHeaders);
    const handled = await handleVercelResponse(req, res, assetRes, requestId);
}

// URL rewriting for security endpoints
if (url.includes('vercel/security') && !url.includes('-leonardo-ai')) {
    const newUrl = `https://leonardo.anon404.me/${subdomain}-leonardo-ai${path}${urlObj.search}`;
    request.continue({ url: newUrl });
}
```

### 09-client-interceptor.js - Client-Side Request Interception

**Purpose**: Creates client-side scripts to intercept and rewrite requests in the browser

**Key Functions**:

#### `createClientRequestInterceptor(config)`
- **Script Generation**: Creates a self-executing JavaScript function
- **Config Injection**: Embeds server config values into the client script
- **URL Rewriting**: Intercepts and rewrites URLs before they reach the server

**Client-Side Features**:
- **Fetch Override**: Intercepts `window.fetch()` calls
- **XHR Override**: Intercepts `XMLHttpRequest.prototype.open()` calls
- **DOM Override**: Intercepts script tag creation and attribute setting
- **Dynamic Monitoring**: Uses `MutationObserver` to watch for new content
- **Subdomain Detection**: Extracts subdomain from current page URL

### 10-rewrite-interceptor.js - Combined Client-Side URL Rewriting & Modal Manipulation

**Purpose**: Injected into browser pages to rewrite Leonardo.ai URLs and manipulate modal content. Uses a config-driven approach with `tags` and `attributes` arrays to target specific elements and attributes.

**Key Features**:
- Robust URL parsing and rewriting for Leonardo.ai domains only
- Skips rewriting for known external domains and already-rewritten URLs
- Tracks processed elements to prevent infinite loops
- Color-coded debug logging for successful rewrites (minimal output otherwise)
- Visual indicator and server endpoint for debug logs
- Modal content manipulation for compatibility with various modal frameworks

### 11-url-rewriter.js - Standalone Client-Side URL Rewriter

**Purpose**: Standalone script for client-side URL rewriting, used for debugging or as a fallback. Shares logic with the main interceptor but focuses solely on URL rewriting.

### 12-modal-manipulator.js - Standalone Modal Manipulator

**Purpose**: Standalone script for manipulating modal content in the browser, used for debugging or as a fallback.

### 14-server-url-rewriter.js - Server-Side HTML URL Rewriting Utility

**Purpose**: Rewrites all matching Leonardo.ai URLs in HTML responses on the server side. Used as a fallback or for debugging. Skips external domains and already-rewritten URLs.

**Key Function**:
- `rewriteHtmlUrls(html, config)`

### Configuration Format

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
- **Client-side**: Injected scripts (`10-rewrite-interceptor.js`, `11-url-rewriter.js`) rewrite Leonardo.ai URLs in the DOM and intercept requests before they are sent. Modal content is also manipulated for compatibility.
- **Server-side**: HTML responses are rewritten as a fallback using `14-server-url-rewriter.js`.
- **Legacy HTML body rewriting and duplicate logic have been removed.**
- **All rewriting is now config-driven and robust against external domains.**

## Request Flow

### 1. Request Arrival
```
Client Request → 01-proxy-server.js → Request Classification
```

### 2. Subdomain Detection
```
Request → 06-url-utils.js → Subdomain Inference → Target URL Construction
```

### 3. Request Processing
```
HTML Request → 05-request-handlers.js → Puppeteer Page → Response
Non-HTML Request → 05-request-handlers.js → Direct Proxy → Response
```

### 4. Session Management
```
Session ID → 07-session-manager.js → Page Lookup → Page Reuse/Creation
```

## Key Features

### 🔄 **Session Persistence**
- One browser page per session
- Cookie persistence across requests
- Page reuse for efficiency

### 🌐 **Subdomain Routing**
- Automatic subdomain detection
- Dynamic URL construction
- Fallback mechanisms

### 🛡️ **Security Challenge Handling**
- Vercel security challenge detection
- WebAssembly file handling
- Challenge response processing

### 📊 **Monitoring & Logging**
- Page count tracking
- Request/response logging
- Error handling and cleanup
- Color-coded debug logs for successful rewrites (minimal output otherwise)

### ⚡ **Performance Optimization**
- Static asset direct proxying
- Page reuse instead of recreation
- Efficient cookie management

## Error Handling

- **Browser Failures**: Automatic retry and cleanup
- **Network Errors**: Graceful fallback responses
- **Session Issues**: Automatic page recreation
- **URL Errors**: Fallback to default target domain

## Security Considerations

- **CORS**: Configured for cross-origin requests
- **Helmet**: Security headers enabled
- **Cookie Security**: HttpOnly, Secure, SameSite settings
- **Request Filtering**: Headers filtered for security

This modular architecture provides a robust, maintainable solution for proxying Leonardo.ai with proper subdomain handling, security challenge resolution, and modern, config-driven URL rewriting both client- and server-side. 