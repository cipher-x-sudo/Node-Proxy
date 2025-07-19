const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const http = require('http');
const https = require('https');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

const COLORS = {
  request: '\x1b[36m',
  proxy: '\x1b[35m',
  puppeteer: '\x1b[32m',
  navigation: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

let browserPromise = puppeteer.launch({
  args: config.proxyEnabled ? [
    `--proxy-server=${config.httpProxy.host}:${config.httpProxy.port}`
  ] : [],
  headless: 'new',
});

const cookieFiles = fs.readdirSync(process.cwd()).filter(f => f.startsWith('cookies') && f.endsWith('.json'));
const globalCookies = [];
for (const file of cookieFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) globalCookies.push(...data);
  } catch {}
}

if (require.main === module) {
  console.log(`\x1b[33m[COOKIES] Loaded ${cookieFiles.length} file(s), ${globalCookies.length} cookies\x1b[0m`);
}

app.use('/assets', express.static(path.join(__dirname, 'assets')));

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

function parseSubdomainFromHost(host, rootDomain) {
  if (!host || !rootDomain) return null;
  const parts = host.split('.');
  const rootParts = rootDomain.split('.');
  if (parts.length > rootParts.length) {
    return parts.slice(0, parts.length - rootParts.length).join('.');
  }
  return null;
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

function proxyResource(targetUrl, req, res) {
  console.log(`${COLORS.proxy}[PROXY] Resource: ${req.method} ${req.originalUrl} -> ${targetUrl}${COLORS.reset}`);
  const client = targetUrl.startsWith('https') ? https : http;
  let mergedCookie = '';
  
  // Extract hostname from targetUrl
  let targetHostname = '';
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch {}
  
  // Check if credentials should be skipped for this domain
  const skipCredentials = Array.isArray(config.noCredentialsDomains) && 
                         config.noCredentialsDomains.includes(targetHostname);
  
  // Build cookies only for domains that require credentials
  if (!skipCredentials && globalCookies.length) {
    mergedCookie = globalCookies.map(c => `${c.name}=${c.value}`).join('; ');
  }
  if (!skipCredentials && req.headers.cookie) {
    mergedCookie = mergedCookie
      ? mergedCookie + '; ' + req.headers.cookie
      : req.headers.cookie;
  }
  
  // Prepare outgoing headers
  const outgoingHeaders = {
    ...req.headers,
    'user-agent': req.headers['user-agent'] || config.userAgent,
    referer: req.headers.referer
      ? (() => {
          try {
            const refUrl = new URL(req.headers.referer);
            const proxyRoot = config.proxyDomain;
            const targetRoot = config.targetDomain;
            const refHost = refUrl.hostname;
            const sub = parseSubdomainFromHost(refHost, proxyRoot);
            const newHost = sub ? `${sub}.${targetRoot}` : targetRoot;
            refUrl.hostname = newHost;
            return refUrl.toString();
          } catch {
            return `https://${config.targetDomain}/`;
          }
        })()
      : `https://${config.targetDomain}/`,
    origin: req.headers.origin || `https://${config.proxyDomain}`,
    ...(skipCredentials ? {} : { cookie: mergedCookie }), // Only include cookies if not skipping
  };
  
  delete outgoingHeaders.host;
  
  const requestOptions = {
    method: req.method,
    headers: outgoingHeaders,
    rejectUnauthorized: client === https ? false : undefined,
  };
  
  const proxyReq = client.request(targetUrl, requestOptions, proxyRes => {
    const headers = { ...proxyRes.headers };
    
    // Handle CORS headers
    if (req.headers.origin) {
      headers['access-control-allow-origin'] = req.headers.origin;
      
      // Only include allow-credentials header for non-skip domains
      if (!skipCredentials) {
        headers['access-control-allow-credentials'] = 'true';
      }
    }
    
    // Handle allowed headers
    const requestedHeaders = req.headers['access-control-request-headers'];
    if (requestedHeaders) {
      headers['access-control-allow-headers'] = requestedHeaders;
    } else {
      headers['access-control-allow-headers'] = 'Content-Type,Authorization,baggage,sentry-trace';
    }
    
    res.writeHead(proxyRes.statusCode, headers);
    
    if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
      console.log(`${COLORS.puppeteer}[SUCCESS] ${req.method} ${targetUrl} -> ${proxyRes.statusCode}${COLORS.reset}`);
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

module.exports = app;

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