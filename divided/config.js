module.exports = {
    proxyDomain: "leonardo.anon404.me",
    targetDomain: "leonardo.ai",
    subdomainMarker: "-leonardo-ai",
    tags: ['img', 'link', 'script', 'iframe'],
    attributes: ['href', 'src', 'content'],
    // Residential proxy configuration
    proxy: {
        enabled: true,
        host: '168.158.197.81', // e.g. 'proxy.iproyal.com'
        port: 12323,  // e.g. 12345
        username: '14a6e05ed94c1',
        password: '5730c9b588'
    }
}; 