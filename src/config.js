// Configuration for Puppeteer Reverse Proxy
const rewritingConstants = require('./rewriting/constants');

module.exports = {
  proxyDomain: process.env.PROXY_DOMAIN || 'localhost:3000', // Your proxy domain
  targetDomain: process.env.TARGET_DOMAIN || 'leonardo.ai',   // The real target domain
  tagsToOverride: rewritingConstants.tagsToOverride,
  attributesToOverride: rewritingConstants.attributesToOverride,
  proxyEnabled: process.env.PROXY_ENABLED === 'true' || process.env.PROXY_ENABLED === undefined ? true : false, // Set to true to use an HTTP proxy
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  httpProxy: {
    host: process.env.HTTP_PROXY_HOST || '161.77.103.115',
    port: parseInt(process.env.HTTP_PROXY_PORT || '44729', 10),
    username: process.env.HTTP_PROXY_USERNAME || '7uFsqCYc65O2fmn',
    password: process.env.HTTP_PROXY_PASSWORD || '3GHBXbTQT7S67Ll'
  },
  rewriteStatic: false,
  injectS1: false,
  skipRewriteDomains: rewritingConstants.skipRewriteDomains,
  noCredentialsDomains: rewritingConstants.noCredentialsDomains,
  noRewriteDomains: rewritingConstants.noRewriteDomains,
  cookiefirstDomains: rewritingConstants.cookiefirstDomains,
  linkedinDomain: rewritingConstants.linkedinDomain,
  additionalDomains: rewritingConstants.additionalDomains,
}; 