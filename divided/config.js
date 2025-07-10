// config.js - Configuration ONLY
module.exports = {
    proxyDomain: process.env.PROXY_DOMAIN || "leonardo.anon404.me", // Your actual domain
    targetDomain: "leonardo.ai",
    pathPrefix: "/leonardo",
    port: process.env.PORT || 3001,
    
    // Environment settings
    environment: process.env.NODE_ENV || 'production',
    
    // SSL/HTTPS settings
    useHttps: process.env.USE_HTTPS === 'true' || true, // Enable HTTPS in production
    
    // Proxy settings (if using residential proxy)
    proxy: {
        enabled: process.env.PROXY_ENABLED === 'true',
        host: process.env.PROXY_HOST,
        port: parseInt(process.env.PROXY_PORT) || 8080,
        username: process.env.PROXY_USERNAME,
        password: process.env.PROXY_PASSWORD
    }
};