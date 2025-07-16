// Configuration for Puppeteer Reverse Proxy

module.exports = {
  proxyDomain: 'localhost:3000', // Your proxy domain
  targetDomain: 'leonardo.ai',   // The real target domain
  tagsToOverride: ['img', 'link', 'script', 'iframe'],
  attributesToOverride: ['href', 'src', 'content'],
  proxyEnabled: true,                // Set to true to use an HTTP proxy
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  httpProxy: {
    host: '86.109.93.239',
    port: 12323,
    username: 'huzaifaphan',
    password: 'huzaifaphan'
  },
  // New option to enable/disable rewriting of static elements
  rewriteStatic: false,
  // New option to enable/disable injection of s1.js
  injectS1: false,

  additionalDomains: [
    'adora-cdn.com',
    'launchdarkly.com',
    'c.adora-cdn.com',
    'app.launchdarkly.com',
    'events.launchdarkly.com' // ADD THIS NEW DOMAIN
  ]
}; 