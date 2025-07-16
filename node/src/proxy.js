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
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    res.set('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,baggage,sentry-trace');
  }
  
  res.status(204).end();
});

// Middleware to handle external proxy requests
app.use((req, res, next) => {
  // Check if this is an external proxy request
  if (req.originalUrl.startsWith('/proxy-external/')) {
    // Extract the full path after /proxy-external/
    const fullPath = req.originalUrl.substring('/proxy-external/'.length);
    
    // Preserve query parameters
    const queryIndex = fullPath.indexOf('?');
    const query = queryIndex !== -1 ? fullPath.substring(queryIndex) : '';
    const pathWithoutQuery = queryIndex !== -1 ? fullPath.substring(0, queryIndex) : fullPath;
    
    // Find the first slash to separate hostname and path
    const firstSlash = pathWithoutQuery.indexOf('/');
    let hostname, path;
    
    if (firstSlash === -1) {
      // No path, just hostname
      hostname = pathWithoutQuery;
      path = '';
    } else {
      // Split into hostname and path
      hostname = pathWithoutQuery.substring(0, firstSlash);
      path = pathWithoutQuery.substring(firstSlash);
    }
    
    // Build target URL
    const targetUrl = `https://${hostname}${path}${query}`;
    
    console.log(`${COLORS.proxy}[EXTERNAL PROXY] ${req.method} ${req.originalUrl} -> ${targetUrl}${COLORS.reset}`);
    
    // Reuse our proxy function
    return proxyResource(targetUrl, req, res);
  }
  
  // If not an external proxy request, continue to next middleware
  next();
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

function buildTargetUrl(subdomain, cleanPath, query) {
  const targetHost = subdomain ? `${subdomain}.${config.targetDomain}` : config.targetDomain;
  return `https://${targetHost}${cleanPath}${query ? '?' + query : ''}`;
}

function loadCookies() {
  const cookieFiles = fs.readdirSync(process.cwd()).filter(f => f.startsWith('cookies') && f.endsWith('.json'));
  let allCookies = [];
  cookieFiles.forEach(file => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data)) allCookies = allCookies.concat(data);
    } catch {}
  });
  return allCookies;
}

function injectScripts(html) {
  const configScript = `<script>window.proxyConfig = ${JSON.stringify({
    proxyDomain: config.proxyDomain,
    targetDomain: config.targetDomain,
    tags: config.tagsToOverride,
    attributes: config.attributesToOverride,
    additionalDomains: config.additionalDomains
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

function rewriteHtml(html, subdomain) {
  const $ = cheerio.load(html, { decodeEntities: false });
  for (const tag of config.tagsToOverride) {
    $(tag).each((_, el) => {
      for (const attr of config.attributesToOverride) {
        const val = $(el).attr(attr);
        if (typeof val === 'string') {
          const domainPattern = config.targetDomain.replace(/\./g, '\\.');
          const absRegex = new RegExp(`^(https?:)?//([a-z0-9-]+)\.${domainPattern}(/.*)$`, 'i');
          const relRegex = new RegExp('^/');
          if (absRegex.test(val)) {
            const match = val.match(absRegex);
            const sub = match[2];
            const path = match[3];
            if (sub && sub !== 'null') {
              $(el).attr(attr, `https://${sub}.${config.proxyDomain}${path}`);
            } else {
              $(el).attr(attr, `https://${config.proxyDomain}${path}`);
            }
          } else if (relRegex.test(val)) {
            if (subdomain && subdomain !== 'null') {
              $(el).attr(attr, `https://${subdomain}.${config.proxyDomain}${val}`);
            } else {
              $(el).attr(attr, `https://${config.proxyDomain}${val}`);
            }
          }
        }
      }
    });
  }
  return $.html();
}

function proxyResource(targetUrl, req, res) {
  console.log(`${COLORS.proxy}[PROXY] Resource: ${req.method} ${req.originalUrl} -> ${targetUrl}${COLORS.reset}`);
  const client = targetUrl.startsWith('https') ? https : http;
  let mergedCookie = '';
  if (globalCookies.length) {
    mergedCookie = globalCookies.map(c => `${c.name}=${c.value}`).join('; ');
  }
  if (req.headers.cookie) {
    mergedCookie = mergedCookie
      ? mergedCookie + '; ' + req.headers.cookie
      : req.headers.cookie;
  }
  
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
    cookie: mergedCookie,
  };
  
  delete outgoingHeaders.host;
  
  const requestOptions = {
    method: req.method,
    headers: outgoingHeaders,
    rejectUnauthorized: client === https ? false : undefined,
  };
  
  const proxyReq = client.request(targetUrl, requestOptions, proxyRes => {
    const headers = { ...proxyRes.headers };
    headers['access-control-allow-origin'] = req.headers.origin || '*';
    headers['access-control-allow-credentials'] = 'true';
    
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