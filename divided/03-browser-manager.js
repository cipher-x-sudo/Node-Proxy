const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { debugLog } = require('./02-utilities');
const config = require('./config');

puppeteer.use(StealthPlugin());

let browser = null;

async function testProxyConnection() {
    if (!config.proxy.enabled) {
        debugLog('Proxy is disabled in config');
        return false;
    }

    debugLog(`Testing proxy connection to ${config.proxy.host}:${config.proxy.port}`);
    
    try {
        const testBrowser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--enable-javascript',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                `--proxy-server=${config.proxy.host}:${config.proxy.port}`
            ]
        });

        const page = await testBrowser.newPage();
        
        // Authenticate the proxy
        await page.authenticate({
            username: config.proxy.username,
            password: config.proxy.password
        });

        // Test connection by visiting a simple page
        await page.goto('https://httpbin.org/ip', { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        const content = await page.content();
        debugLog('Proxy connection test successful');
        
        await testBrowser.close();
        return true;
    } catch (error) {
        debugLog(`Proxy connection test failed: ${error.message}`);
        return false;
    }
}

async function initBrowser() {
    if (!browser) {
        debugLog('Initializing browser instance');
        
        // Test proxy connection first
        if (config.proxy.enabled) {
            const proxyWorking = await testProxyConnection();
            if (!proxyWorking) {
                debugLog('Warning: Proxy connection test failed, but continuing with proxy configuration');
            }
        }

        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--enable-javascript',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        };

        // Add proxy configuration if enabled
        if (config.proxy.enabled) {
            launchOptions.args.push(`--proxy-server=${config.proxy.host}:${config.proxy.port}`);
            debugLog(`Browser configured to use proxy: ${config.proxy.host}:${config.proxy.port}`);
        }

        browser = await puppeteer.launch(launchOptions);
        debugLog('Browser instance created successfully');
    }
    return browser;
}

async function createPage() {
    const browserInstance = await initBrowser();
    const page = await browserInstance.newPage();
    
    // Authenticate proxy if enabled
    if (config.proxy.enabled) {
        await page.authenticate({
            username: config.proxy.username,
            password: config.proxy.password
        });
        debugLog('Page authenticated with proxy');
    }
    
    return page;
}

module.exports = {
    initBrowser,
    createPage,
    testProxyConnection
}; 