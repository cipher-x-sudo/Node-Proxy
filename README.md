# Leonardo Reverse Proxy - Documentation

## Overview

This project is a reverse proxy system built with Node.js, Express, and Puppeteer. It is designed to proxy, rewrite, and inject scripts into requests and responses for the target domain `leonardo.ai` (and its subdomains), supporting advanced use cases such as cookie management, CORS handling, and client-side request rewriting.

## Architecture

- **server.js**: Entry point. Runs a bridge server that forwards all requests to the main proxy.
- **src/proxy.js**: The main reverse proxy logic. Handles HTTP(S) requests, Puppeteer browser automation, cookie management, CORS, and script injection.
- **src/config.js**: Central configuration for domains, proxy settings, user agent, and rewrite rules.
- **src/assets/**: Client-side scripts injected into proxied pages for rewriting requests and resources.
- **src/cookies*.json**: Cookie jar files used for session management and authentication.

## File Structure

- [server.js](docs/server.md)
- [src/proxy.js](docs/proxy.md)
- [src/config.js](docs/config.md)
- [src/assets/rewrite-requests.js](docs/rewrite-requests.md)
- [src/assets/s1.js](docs/s1.md)
- [src/assets/s2.js](docs/s2.md)
- [src/cookies1.json](docs/cookies1.md)
- [src/cookies2.json](docs/cookies2.md)
- [src/cookies3.json](docs/cookies3.md)
- [src/cookies4.json](docs/cookies4.md)
- [src/cookies5.json](docs/cookies5.md)

Each file above is documented in detail, line by line, in its respective markdown file in the `docs/` directory.

## How It Works

1. **Bridge Server** (`server.js`): Listens on a port and forwards all requests to the main proxy server.
2. **Proxy Server** (`src/proxy.js`): Handles incoming requests, rewrites URLs, manages cookies, injects scripts, and proxies API/static/resource requests to the target domain.
3. **Client-Side Scripts** (`src/assets/`): Injected into proxied pages to rewrite outgoing requests and resource URLs, ensuring seamless operation under the proxy domain.
4. **Configuration** (`src/config.js`): Centralizes all settings for easy customization.
5. **Cookies** (`src/cookies*.json`): Used for session persistence and authentication with the target domain.

---

For detailed, line-by-line explanations, see the linked documentation for each file above. 