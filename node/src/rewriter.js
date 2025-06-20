const cheerio = require('cheerio');

function rewriteHtmlUrls(html, targetDomain, proxyDomain) {
    const $ = cheerio.load(html, { decodeEntities: false });
    const tags = ['a', 'link', 'script', 'img', 'iframe', 'form', 'source', 'video', 'audio'];
    const attrs = ['href', 'src', 'action', 'poster', 'data-src', 'data-href'];
    tags.forEach(tag => {
        $(tag).each((_, el) => {
            attrs.forEach(attr => {
                const val = $(el).attr(attr);
                if (val && typeof val === 'string') {
                    try {
                        const urlObj = new URL(val, `https://${targetDomain}`);
                        if (urlObj.hostname === targetDomain || urlObj.hostname.endsWith('.' + targetDomain)) {
                            let newPath = '';
                            if (urlObj.hostname === targetDomain) {
                                newPath = urlObj.pathname + (urlObj.search || '') + (urlObj.hash || '');
                                $(el).attr(attr, `https://${proxyDomain}${newPath}`);
                            } else {
                                const sub = urlObj.hostname.split('.')[0];
                                newPath = `/${sub}-${targetDomain.replace('.', '-')}${urlObj.pathname}${urlObj.search || ''}${urlObj.hash || ''}`;
                                $(el).attr(attr, `https://${proxyDomain}${newPath}`);
                            }
                        }
                    } catch (e) {
                        // Not a valid URL, skip
                    }
                }
            });
        });
    });
    return $.html();
}

// Placeholder for other types (API, JSON, etc.)
function rewriteOther(data, targetDomain, proxyDomain) {
    // Implement if needed
    return data;
}

module.exports = {
    rewriteHtmlUrls,
    rewriteOther
}; 