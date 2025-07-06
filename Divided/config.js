module.exports = {
    proxyDomain: "leonardo.anon404.me",
    targetDomain: "leonardo.ai",
    subdomainMarker: "-leonardo-ai",
    tags: ['img', 'link', 'script', 'iframe'],
    attributes: ['href', 'src', 'content'],
    // Residential proxy configuration
    proxy: {
        enabled: true,
        host: '86.109.93.239', // e.g. 'proxy.iproyal.com'
        port: 12323,  // e.g. 12345
        username: 'huzaifaphan',
        password: 'huzaifaphan'
    }
}; 