const config = require('./config');
const { debugLog } = require('./02-utilities');

function inferSubdomain(req, config, currentBrowserUrl) {
    // 1. First priority: Check current browser URL
    if (currentBrowserUrl && currentBrowserUrl !== '[none]' && currentBrowserUrl !== '[error retrieving URL]') {
        try {
            const url = new URL(currentBrowserUrl);
            // Use regex to validate protocol and domain
            if ((url.protocol === 'https:' || url.protocol === 'http:') && 
                /^(?:[a-z0-9-]+\.)?leonardo\.ai$/i.test(url.hostname)) {
                const subMatch = url.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
                if (subMatch) {
                    return subMatch[1];
                }
            }
        } catch (e) {}
    }
    
    // 2. Second priority: Check path-based subdomain
    const subdomainPattern = new RegExp(`^\\/([a-z0-9-]+)${config.subdomainMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\/.*)?$`, 'i');
    const match = req.path.match(subdomainPattern);
    if (match) {
        return match[1];
    }
    
    // 3. Third priority: Check referer header
    const referer = req.headers['referer'] || req.headers['referrer'];
    if (referer) {
        try {
            const url = new URL(referer);
            // Use regex to validate protocol and domain
            if ((url.protocol === 'https:' || url.protocol === 'http:') && 
                /^(?:[a-z0-9-]+\.)?leonardo\.ai$/i.test(url.hostname)) {
                const subMatch = url.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
                if (subMatch) {
                    return subMatch[1];
                }
            }
        } catch (e) {}
    }
    
    return null;
}

async function getSubdomainFromSession(sid, sessionPages) {
    const page = sessionPages.get(sid);
    if (page) {
        try {
            const pageUrl = await page.url();
            if (pageUrl && pageUrl !== '[none]' && pageUrl !== '[error retrieving URL]') {
                const url = new URL(pageUrl);
                // Use regex to validate protocol and domain
                if ((url.protocol === 'https:' || url.protocol === 'http:') && 
                    /^(?:[a-z0-9-]+\.)?leonardo\.ai$/i.test(url.hostname)) {
                    const subMatch = url.hostname.match(/^([a-z0-9-]+)\.leonardo\.ai$/i);
                    if (subMatch) {
                        return subMatch[1];
                    }
                }
            }
        } catch (e) {}
    }
    return null;
}

function getTargetUrl(req, config, subdomain) {
    let rest = req.path;
    
    // Remove subdomain marker from path if present
    const subdomainPattern = new RegExp(`^\\/([a-z0-9-]+)${config.subdomainMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\/.*)?$`, 'i');
    const match = req.path.match(subdomainPattern);
    if (match) {
        // If we extracted a subdomain from the path, use it
        const pathSubdomain = match[1];
        if (!subdomain) {
            subdomain = pathSubdomain;
        }
        // The rest should be the full path after the subdomain marker
        rest = match[2] || '/';
        debugLog(`getTargetUrl - Extracted subdomain from path: ${pathSubdomain}, Rest: ${rest}`);
    }
    
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    
    if (subdomain) {
        const targetUrl = `https://${subdomain}.leonardo.ai${rest}${query}`;
        debugLog(`getTargetUrl - Final target URL: ${targetUrl}`);
        return targetUrl;
    } else {
        const targetUrl = `https://${config.targetDomain}${rest}${query}`;
        debugLog(`getTargetUrl - Final target URL (no subdomain): ${targetUrl}`);
        return targetUrl;
    }
}

module.exports = {
    inferSubdomain,
    getSubdomainFromSession,
    getTargetUrl
}; 