const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const http = require('http');
const https = require('https');
const cheerio = require('cheerio');

// Import config service and admin routes
const { getConfig } = require('./services/config');
const { initializeDatabase } = require('./db/connection');
const { migrateConfig } = require('./db/migrations/migrate-config');
const { migrateAccounts } = require('./db/migrations/migrate-accounts');
const { router: authRouter, createDefaultAdmin } = require('./auth/routes');
const adminRouter = require('./routes/admin');
const { getCookies, migrateCookies } = require('./services/cookies');
const { getAccountBySlug, getDefaultAccount } = require('./services/accounts');

const app = express();
const PORT = process.env.PORT || 3000;

// Load config (will use database with file fallback)
// Start with file config for immediate use, then reload from database
let config = require('./config');

const COLORS = {
  request: '\x1b[36m',
  proxy: '\x1b[35m',
  puppeteer: '\x1b[32m',
  navigation: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

function launchBrowser() {
  return puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      ...(config.proxyEnabled ? [
        `--proxy-server=${config.httpProxy.host}:${config.httpProxy.port}`
      ] : [])
    ],
    headless: 'new',
  });
}

let browserPromise = launchBrowser();

// Cookies will be loaded from database with file fallback
// Use getCookies() function to get fresh cookies (with caching)

// Middleware - only parse JSON for admin routes, not for proxy routes
app.use(cookieParser());

// Body parsing for admin routes only (will be applied before admin routes)
const bodyParser = express.json({ limit: '50mb' });
const urlEncodedParser = express.urlencoded({ extended: true, limit: '50mb' });

// Serve static assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/admin/assets', express.static(path.join(__dirname, 'admin/assets')));

// Admin routes (with body parsing)
app.use('/api/admin/auth', bodyParser, urlEncodedParser, authRouter);
app.use('/api/admin', bodyParser, urlEncodedParser, adminRouter);

// Serve admin pages
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin/login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin/index.html'));
});

app.options(/.*/, (req, res) => {
  const origin = req.headers.origin;

  // Set CORS headers for any origin
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
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

function parseSubdomainFromHost(host, rootDomain) {
  if (!host || !rootDomain) return null;
  // Remove port if present (e.g., "app.hostme360.tech:443" -> "app.hostme360.tech")
  const hostWithoutPort = host.split(':')[0];
  const rootWithoutPort = rootDomain.split(':')[0];
  const parts = hostWithoutPort.split('.');
  const rootParts = rootWithoutPort.split('.');
  if (parts.length > rootParts.length) {
    return parts.slice(0, parts.length - rootParts.length).join('.');
  }
  return null;
}

/**
 * Resolve account from path prefix /a/<slug>/ or header X-Proxy-Account, else default account.
 * Returns { accountId, accountSlug, pathPrefix, cleanPath }.
 */
async function resolveAccount(req) {
  const pathPrefix = '/a/';
  const pathMatch = req.path.match(new RegExp('^' + pathPrefix.replace('/', '\\/') + '([^/]+)(\\/.*)?$'));
  if (pathMatch) {
    const slug = pathMatch[1];
    const pathRest = (pathMatch[2] || '/').replace(/^\/$/, '/');
    const account = await getAccountBySlug(slug);
    if (account) {
      return {
        accountId: account.id,
        accountSlug: account.slug,
        pathPrefix: pathPrefix + account.slug + '/',
        cleanPath: pathRest,
      };
    }
  }
  const headerSlug = req.headers['x-proxy-account'];
  if (headerSlug && typeof headerSlug === 'string') {
    const account = await getAccountBySlug(headerSlug.trim());
    if (account) {
      return {
        accountId: account.id,
        accountSlug: account.slug,
        pathPrefix: '',
        cleanPath: req.path,
      };
    }
  }
  const defaultAccount = await getDefaultAccount();
  if (defaultAccount) {
    return {
      accountId: defaultAccount.id,
      accountSlug: defaultAccount.slug,
      pathPrefix: '',
      cleanPath: req.path,
    };
  }
  return { accountId: null, accountSlug: null, pathPrefix: '', cleanPath: req.path };
}

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

// NEW: Check if URL is an API request that should be proxied
function isApiRequest(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const hostname = url.hostname.toLowerCase();
    
    // Check for API subdomains
    if (hostname.startsWith('api.')) {
      return true;
    }
    
    // Check for GraphQL endpoints
    if (url.pathname.includes('/graphql') || url.pathname.includes('/v1/graphql')) {
      return true;
    }
    
    // Check for specific API domains
    const apiDomains = [
      'braintreegateway.com',
      'braintree-api.com',
      'payments.braintree-api.com',
      'api.braintreegateway.com'
    ];
    
    return apiDomains.some(domain => hostname.includes(domain));
  } catch {
    // Fallback string matching
    const lowerUrl = targetUrl.toLowerCase();
    return lowerUrl.includes('api.leonardo.ai') || 
           lowerUrl.includes('api.hostme360.tech') || 
           lowerUrl.includes('/v1/graphql') || 
           lowerUrl.includes('/graphql') ||
           lowerUrl.includes('braintreegateway.com') ||
           lowerUrl.includes('braintree-api.com');
  }
}

async function proxyResource(targetUrl, req, res, accountContext = {}) {
  const { accountId = null, accountSlug = null } = accountContext;
  console.log(`${COLORS.proxy}[PROXY] Resource: ${req.method} ${req.originalUrl} -> ${targetUrl}${COLORS.reset}`);
  
  // NEW: Special handling for API requests
  if (isApiRequest(targetUrl)) {
    console.log(`${COLORS.proxy}[PROXY] Handling API request: ${targetUrl}${COLORS.reset}`);
    
    const client = targetUrl.startsWith('https') ? https : http;
    
    // Prepare headers - remove headers that shouldn't be forwarded
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length']; // Let Node.js calculate this
    delete headers['connection'];
    delete headers['transfer-encoding'];
    
    // Set user agent if not present
    if (!headers['user-agent']) {
      headers['user-agent'] = config.userAgent;
    }
    
    const requestOptions = {
      method: req.method,
      headers: headers,
      rejectUnauthorized: false,
      timeout: 30000, // 30 second timeout
    };
    
    const proxyReq = client.request(targetUrl, requestOptions, proxyRes => {
      const headers = { 
        ...proxyRes.headers
      };
      
      // Handle response errors (inside callback where proxyRes is available)
      proxyRes.on('error', err => {
        if (!res.headersSent) {
          console.log(`${COLORS.error}[ERROR] API proxy response error for ${targetUrl}: ${err.message}${COLORS.reset}`);
          res.status(502).json({ 
            error: 'API proxy response error', 
            message: err.message
          });
        }
      });
      
      // Rewrite redirect Location headers to go through proxy (preserve account path prefix)
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && headers.location) {
        try {
          const redirectUrl = new URL(headers.location, targetUrl);
          if (redirectUrl.hostname === config.targetDomain || redirectUrl.hostname.endsWith('.' + config.targetDomain)) {
            const sub = parseSubdomainFromHost(redirectUrl.hostname, config.targetDomain);
            const protocol = (req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-ssl'] === 'on') ? 'https' : 'http';
            const baseProxyDomain = config.proxyDomain.split(':')[0];
            const newHost = sub ? `${sub}.${baseProxyDomain}` : baseProxyDomain;
            const pathWithAccount = accountSlug ? '/a/' + accountSlug + (redirectUrl.pathname === '/' ? '' : redirectUrl.pathname) : redirectUrl.pathname;
            headers.location = `${protocol}://${newHost}${pathWithAccount}${redirectUrl.search}${redirectUrl.hash}`;
            console.log(`${COLORS.proxy}[PROXY] Rewrote API redirect: ${redirectUrl.toString()} -> ${headers.location}${COLORS.reset}`);
          }
        } catch (err) {
          console.log(`${COLORS.error}[ERROR] Failed to rewrite API redirect location: ${err.message}${COLORS.reset}`);
        }
      }
      
      // Set CORS headers - must use specific origin when credentials are enabled
      if (req.headers.origin) {
        headers['access-control-allow-origin'] = req.headers.origin;
        headers['access-control-allow-credentials'] = 'true';
      } else {
        headers['access-control-allow-origin'] = '*';
      }
      
      headers['access-control-allow-methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
      
      const requestedHeaders = req.headers['access-control-request-headers'];
      if (requestedHeaders) {
        headers['access-control-allow-headers'] = requestedHeaders;
      } else {
        headers['access-control-allow-headers'] = 'Content-Type,Authorization,baggage,sentry-trace';
      }
      
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });
    
    // Handle request errors
    proxyReq.on('error', err => {
      if (!res.headersSent) {
        console.log(`${COLORS.error}[ERROR] API proxy error for ${targetUrl}: ${err.message}${COLORS.reset}`);
        console.log(`${COLORS.error}[ERROR] Original request: ${req.method} ${req.originalUrl}${COLORS.reset}`);
        console.log(`${COLORS.error}[ERROR] Error details: ${JSON.stringify({ code: err.code, errno: err.errno, syscall: err.syscall })}${COLORS.reset}`);
        res.status(502).json({ 
          error: 'API proxy error', 
          message: err.message,
          targetUrl: targetUrl,
          originalUrl: req.originalUrl
        });
      }
    });
    
    // Handle client disconnect
    req.on('aborted', () => {
      proxyReq.destroy();
    });
    
    res.on('close', () => {
      proxyReq.destroy();
    });
    
    // Forward request body for POST/PUT/PATCH
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
      // Check if there's a content-length header
      const contentLength = req.headers['content-length'];
      
      if (contentLength && parseInt(contentLength) > 0) {
        // If body was already parsed by middleware, write it manually
        if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
          const bodyStr = JSON.stringify(req.body);
          requestOptions.headers['content-length'] = Buffer.byteLength(bodyStr);
          proxyReq.write(bodyStr);
          proxyReq.end();
        } else {
          // Pipe the raw request stream
          req.on('error', err => {
            if (!res.headersSent) {
              console.log(`${COLORS.error}[ERROR] Request stream error: ${err.message}${COLORS.reset}`);
              proxyReq.destroy();
            }
          });
          
          req.pipe(proxyReq, { end: true });
        }
      } else {
        // No body, just end the request
        proxyReq.end();
      }
    } else {
      proxyReq.end();
    }
    return;
  }
  
  // Existing proxy logic for non-API requests
  const client = targetUrl.startsWith('https') ? https : http;
  let mergedCookie = '';

  let targetHostname = '';
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch {}

  const skipCredentials = Array.isArray(config.noCredentialsDomains) &&
                         config.noCredentialsDomains.includes(targetHostname);

  if (!skipCredentials && accountId) {
    const cookies = await getCookies(accountId);
    if (cookies.length) {
      mergedCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
  }
  if (!skipCredentials && req.headers.cookie) {
    mergedCookie = mergedCookie
      ? mergedCookie + '; ' + req.headers.cookie
      : req.headers.cookie;
  }

  const refererValue = req.headers.referer
    ? (() => {
        try {
          const refUrl = new URL(req.headers.referer);
          const proxyRoot = config.proxyDomain;
          const targetRoot = config.targetDomain;
          const refHost = refUrl.hostname;
          const sub = parseSubdomainFromHost(refHost, proxyRoot);
          const newHost = sub ? `${sub}.${targetRoot}` : targetRoot;
          refUrl.hostname = newHost;
          if (accountSlug && refUrl.pathname.startsWith('/a/' + accountSlug + '/')) {
            refUrl.pathname = refUrl.pathname.slice(('/a/' + accountSlug).length) || '/';
          } else if (accountSlug && refUrl.pathname === '/a/' + accountSlug) {
            refUrl.pathname = '/';
          }
          return refUrl.toString();
        } catch {
          return `https://${config.targetDomain}/`;
        }
      })()
    : `https://${config.targetDomain}/`;

  const outgoingHeaders = {
    ...req.headers,
    'user-agent': req.headers['user-agent'] || config.userAgent,
    referer: refererValue,
    origin: req.headers.origin || `https://${config.proxyDomain}`,
    ...(skipCredentials ? {} : { cookie: mergedCookie }),
  };
  
  delete outgoingHeaders.host;
  
  const requestOptions = {
    method: req.method,
    headers: outgoingHeaders,
    rejectUnauthorized: client === https ? false : undefined,
  };
  
  const proxyReq = client.request(targetUrl, requestOptions, proxyRes => {
    const headers = { ...proxyRes.headers };
    
    // Rewrite redirect Location headers to go through proxy (preserve account path prefix)
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && headers.location) {
      try {
        const redirectUrl = new URL(headers.location, targetUrl);
        if (redirectUrl.hostname === config.targetDomain || redirectUrl.hostname.endsWith('.' + config.targetDomain)) {
          const sub = parseSubdomainFromHost(redirectUrl.hostname, config.targetDomain);
          const protocol = (req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-ssl'] === 'on') ? 'https' : 'http';
          const baseProxyDomain = config.proxyDomain.split(':')[0];
          const newHost = sub ? `${sub}.${baseProxyDomain}` : baseProxyDomain;
          const pathWithAccount = accountSlug ? '/a/' + accountSlug + (redirectUrl.pathname === '/' ? '' : redirectUrl.pathname) : redirectUrl.pathname;
          headers.location = `${protocol}://${newHost}${pathWithAccount}${redirectUrl.search}${redirectUrl.hash}`;
          console.log(`${COLORS.proxy}[PROXY] Rewrote redirect: ${redirectUrl.toString()} -> ${headers.location}${COLORS.reset}`);
        }
      } catch (err) {
        console.log(`${COLORS.error}[ERROR] Failed to rewrite redirect location: ${err.message}${COLORS.reset}`);
      }
    }

    // Always set CORS headers if origin is present
    if (req.headers.origin) {
      headers['access-control-allow-origin'] = req.headers.origin;
      // Always set credentials to 'true' for CORS when origin is present
      // (skipCredentials is about sending cookies TO the target, not CORS headers)
      headers['access-control-allow-credentials'] = 'true';
    }
    
    // Always set allow-methods for CORS
    headers['access-control-allow-methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
    
    const requestedHeaders = req.headers['access-control-request-headers'];
    if (requestedHeaders) {
      headers['access-control-allow-headers'] = requestedHeaders;
    } else {
      headers['access-control-allow-headers'] = 'Content-Type,Authorization,baggage,sentry-trace';
    }

    // Strip headers that cause ERR_BLOCKED_BY_RESPONSE.NotSameOrigin when proxied (browser sees same-origin)
    delete headers['cross-origin-resource-policy'];
    delete headers['cross-origin-embedder-policy'];
    delete headers['cross-origin-opener-policy'];

    res.writeHead(proxyRes.statusCode, headers);
    
    if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
      console.log(`${COLORS.puppeteer}[SUCCESS] ${req.method} ${targetUrl} -> ${proxyRes.statusCode}${COLORS.reset}`);
    } else if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
      console.log(`${COLORS.proxy}[REDIRECT] ${req.method} ${targetUrl} -> ${proxyRes.statusCode} ${headers.location}${COLORS.reset}`);
    } else {
      console.log(`${COLORS.error}[FAILED] ${req.method} ${targetUrl} -> ${proxyRes.statusCode}${COLORS.reset}`);
    }
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', err => {
    console.log(`${COLORS.error}[ERROR] Proxy error for ${targetUrl}: ${err.message}${COLORS.reset}`);
    res.statusCode = 502;
    res.end('Proxy error: ' + err.message);
  });
  
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

function isStaticResource(path) {
  return (
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|ogg|mp3|json|map)$/i.test(path) ||
    path.includes('/_next/static/') ||
    path.includes('/static/') ||
    path.includes('/assets/') ||
    path.includes('/_next/image') ||
    path.includes('/fonts/') ||
    path.includes('/_next/')
  );
}

app.use(async (req, res) => {
  console.log(`${COLORS.request}[REQUEST] ${req.method} ${req.originalUrl}${COLORS.reset}`);
  const resolved = await resolveAccount(req);
  const { accountId, accountSlug, cleanPath } = resolved;
  const accountContext = { accountId, accountSlug };

  const rootDomain = config.proxyDomain;
  const host = (req.hostname || req.headers.host || '').split(':')[0];
  const subdomain = parseSubdomainFromHost(host, rootDomain);
  const queryPart = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  let targetUrl;
  if (subdomain) {
    targetUrl = `https://${subdomain}.${config.targetDomain}${cleanPath}${queryPart}`;
    console.log(`${COLORS.proxy}[PROXY] Subdomain: ${subdomain} | CleanPath: ${cleanPath} | Target: ${targetUrl}${COLORS.reset}`);
  } else {
    targetUrl = `https://${config.targetDomain}${cleanPath}${queryPart}`;
    console.log(`${COLORS.proxy}[PROXY] No subdomain | CleanPath: ${cleanPath} | Target: ${targetUrl}${COLORS.reset}`);
  }

  const staticResource = isStaticResource(cleanPath);
  const accept = req.headers.accept || '';

  if (isApiRequest(targetUrl)) {
    await proxyResource(targetUrl, req, res, accountContext);
    return;
  }

  if (!staticResource && accept.includes('text/html')) {
    let browser;
    try {
      browser = await browserPromise;
    } catch (err) {
      console.log(`${COLORS.puppeteer}[PUPPETEER] Browser not ready, launching...${COLORS.reset}`);
      browserPromise = launchBrowser();
      browser = await browserPromise;
    }
    if (!browser.isConnected()) {
      console.log(`${COLORS.puppeteer}[PUPPETEER] Browser disconnected, relaunching...${COLORS.reset}`);
      browserPromise = launchBrowser();
      browser = await browserPromise;
    }
    const page = await browser.newPage();
    await page.setUserAgent(config.userAgent);

    if (accountId) {
      const cookies = await getCookies(accountId);
      if (cookies.length) {
        try {
          await page.setCookie(...cookies);
          console.log(COLORS.puppeteer + '[PUPPETEER] Cookies set for page' + COLORS.reset);
        } catch (e) {
          console.log(COLORS.error + '[ERROR] Failed to set cookies for page: ' + e.message + COLORS.reset);
        }
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
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err) {
      navigationError = err;
      console.log(`${COLORS.error}[ERROR] Puppeteer navigation error for ${targetUrl}: ${err.message}${COLORS.reset}`);
    }

    let body;
    if (navigationError) {
      // On timeout/error, try to serve whatever content we have (page may have partial HTML)
      try {
        body = await page.content();
      } catch (e) {
        body = '';
      }
      if (body && body.length > 500 && body.includes('</body>')) {
        console.log(`${COLORS.puppeteer}[PUPPETEER] Served partial content after ${navigationError.message}${COLORS.reset}`);
        navigationError = null;
      } else {
        res.status(502).send('Failed to load resource: ' + navigationError.message);
        await page.close();
        return;
      }
    }

    if (!body) {
      body = await page.content();
    }
    body = injectScripts(body);
    
    res.set('Content-Type', 'text/html');
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Content-Security-Policy', "default-src 'self' https: 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' https: *;");
    
    console.log(`${COLORS.puppeteer}[PUPPETEER] Served HTML with injected scripts for ${targetUrl}${COLORS.reset}`);
    res.status(200).send(body);
    await page.close();
  } else {
    await proxyResource(targetUrl, req, res, accountContext);
    return;
  }
});

module.exports = app;

if (require.main === module) {
  // Initialize database and start server
  (async () => {
    try {
      // Initialize database
      await initializeDatabase();
      
      // Create default admin user
      await createDefaultAdmin();
      
      // Migrate existing config to database (if not already migrated)
      try {
        await migrateConfig();
      } catch (error) {
        console.warn('Config migration skipped (may already be migrated):', error.message);
      }

      // Migrate to multi-account support (accounts table, account_id on cookies, default account)
      try {
        await migrateAccounts();
      } catch (error) {
        console.warn('Accounts migration skipped (may already be migrated):', error.message);
      }
      
      // Reload config from database (will merge with env vars)
      const dbConfig = await getConfig();
      if (dbConfig) {
        config = dbConfig;
        console.log('Configuration loaded from database');
      }
      
      // Load cookies from database (for initial count, default account)
      const defaultAccount = await getDefaultAccount();
      const initialCookies = defaultAccount ? await getCookies(defaultAccount.id) : [];
      console.log(`\x1b[33m[COOKIES] Loaded ${initialCookies.length} cookie(s) for default account from database\x1b[0m`);
      
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

      // Ensure browser is ready and log; relaunch on disconnect
      try {
        const browser = await browserPromise;
        const version = await browser.version().catch(() => 'unknown');
        console.log(`${COLORS.puppeteer}[PUPPETEER] Browser ready (${version})${COLORS.reset}`);
        browser.on('disconnected', () => {
          console.log(`${COLORS.puppeteer}[PUPPETEER] Browser disconnected, will relaunch on next request${COLORS.reset}`);
          browserPromise = launchBrowser();
        });
      } catch (err) {
        console.error(`${COLORS.error}[PUPPETEER] Browser launch failed: ${err.message}${COLORS.reset}`);
        console.log(`${COLORS.puppeteer}[PUPPETEER] Will retry on first HTML request${COLORS.reset}`);
        browserPromise = launchBrowser();
      }

      // Use HTTP only - Railway handles HTTPS termination at the edge
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Proxy server running on http://0.0.0.0:${PORT}`);
        console.log(`Admin panel available at http://0.0.0.0:${PORT}/admin`);
      });
    } catch (error) {
      console.error('Failed to initialize:', error);
      // Fallback to file config if database fails
      console.log('Falling back to file-based configuration...');
      config = require('./config');
      
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Proxy server running on http://0.0.0.0:${PORT} (file config mode)`);
      });
    }
  })();
}