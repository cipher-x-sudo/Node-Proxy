# Leonardo Reverse Proxy - Documentation

## Overview

This project is a reverse proxy system built with Node.js, Express, and Puppeteer. It is designed to proxy, rewrite, and inject scripts into requests and responses for the target domain `leonardo.ai` (and its subdomains), supporting advanced use cases such as cookie management, CORS handling, and client-side request rewriting.

## Architecture

- **server.js**: Entry point. Runs a bridge server that forwards all requests to the main proxy.
- **src/proxy.js**: The main reverse proxy logic. Handles HTTP(S) requests, Puppeteer browser automation, cookie management, CORS, and script injection.
- **src/config.js**: Central configuration for domains, proxy settings, user agent, and rewrite rules.
- **src/rewriting/**: All rewriting logic—constants, server helpers, and client scripts (shared.js, rewrite-requests.js, s1.js, s2.js) injected into proxied pages.
- **src/cookies*.json**: Cookie jar files used for session management and authentication.

## File Structure

- [server.js](docs/server.md)
- [src/proxy.js](docs/proxy.md)
- [src/config.js](docs/config.md)
- [src/rewriting/](src/rewriting/) – constants, server helpers, client scripts (shared.js, rewrite-requests.js, s1.js, s2.js)
- [src/cookies1.json](docs/cookies1.md)
- [src/cookies2.json](docs/cookies2.md)
- [src/cookies3.json](docs/cookies3.md)
- [src/cookies4.json](docs/cookies4.md)
- [src/cookies5.json](docs/cookies5.md)

Each file above is documented in detail, line by line, in its respective markdown file in the `docs/` directory.

## How It Works

1. **Bridge Server** (`server.js`): Listens on a port and forwards all requests to the main proxy server.
2. **Proxy Server** (`src/proxy.js`): Handles incoming requests, rewrites URLs, manages cookies, injects scripts, and proxies API/static/resource requests to the target domain.
3. **Rewriting** (`src/rewriting/`): Server-side helpers and client scripts (shared, rewrite-requests, s1, s2) injected into proxied pages to rewrite outgoing requests and resource URLs.
4. **Configuration** (`src/config.js`): Centralizes all settings for easy customization.
5. **Cookies** (`src/cookies*.json`): Used for session persistence and authentication with the target domain.

---

For detailed, line-by-line explanations, see the linked documentation for each file above. 