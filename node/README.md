# Hailuo Proxy Server

A Node.js-based proxy server for Hailuo AI, built with Express and Puppeteer.

## Features

- Subdomain-based routing
- Cookie management
- URL rewriting for HTML, CSS, and JSON responses
- Client-side URL rewriting
- Security headers and CORS support

## Prerequisites

- Node.js 14.x or higher
- npm 6.x or higher

## Installation

1. Clone the repository
2. Navigate to the project directory
3. Install dependencies:
```bash
npm install
```

## Configuration

The configuration is stored in `src/config.js`. You can modify the following settings:

- `proxyDomain`: Your proxy domain
- `targetDomain`: The target domain to proxy
- `subdomainMarker`: The marker used in subdomain routing
- `tagsToOverride`: HTML tags to process for URL rewriting
- `attributesToOverride`: HTML attributes to process for URL rewriting

## Usage

1. Start the server:
```bash
npm start
```

2. The server will run on port 3000 by default. You can change this by setting the `PORT` environment variable.

3. Access the proxy through your configured domain (e.g., `https://hailuo.anon404.me`).

## Cookie Management

The application uses cookies stored in `cookies2.json`. Make sure this file exists and contains the necessary cookie data in the following format:

```json
[
  {
    "name": "cookie_name",
    "value": "cookie_value"
  }
]
```

## Security

The application includes several security features:

- Content Security Policy (CSP) headers
- CORS configuration
- Helmet.js for additional security headers
- Cookie management and filtering

## License

MIT 