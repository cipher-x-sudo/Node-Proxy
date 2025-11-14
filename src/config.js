// Configuration for Puppeteer Reverse Proxy

module.exports = {
  proxyDomain: process.env.PROXY_DOMAIN || 'localhost:3000', // Your proxy domain
  targetDomain: process.env.TARGET_DOMAIN || 'leonardo.ai',   // The real target domain
  tagsToOverride: ['img', 'link', 'script', 'iframe'],
  attributesToOverride: ['href', 'src', 'content'],
  proxyEnabled: process.env.PROXY_ENABLED === 'true' || process.env.PROXY_ENABLED === undefined ? true : false, // Set to true to use an HTTP proxy
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  httpProxy: {
    host: process.env.HTTP_PROXY_HOST || '86.109.93.239',
    port: parseInt(process.env.HTTP_PROXY_PORT || '12323', 10),
    username: process.env.HTTP_PROXY_USERNAME || 'huzaifaphan',
    password: process.env.HTTP_PROXY_PASSWORD || 'huzaifaphan'
  },
  // New option to enable/disable rewriting of static elements
  rewriteStatic: false,
  // New option to enable/disable injection of s1.js
  injectS1: false,

  skipRewriteDomains: [
    'consent.cookiefirst.com'
    
  ],
  // Domains for which credentials (cookies, etc) should NOT be sent
  noCredentialsDomains: [
    'app.launchdarkly.com',
    'events.launchdarkly.com',
    'c.adora-cdn.com',
    'consent.cookiefirst.com',
    'api.leonardo.ai'
  ]
}; 