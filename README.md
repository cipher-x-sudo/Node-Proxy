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

## The Problem

The main issue is that JavaScript code in the browser is making requests to wrong URLs:
- **Wrong**: `/.well-known/vercel/security/static/challenge.v2.min.js`
- **Correct**: `/app-leonardo-ai/.well-known/vercel/security/static/challenge.v2.min.js`

## Current Solution

The system uses server-side URL rewriting through Puppeteer request interception:
- Uses request interception in Puppeteer
- Rewrites URLs on the server side
- Handles Vercel security challenges through the dedicated Vercel handler module 