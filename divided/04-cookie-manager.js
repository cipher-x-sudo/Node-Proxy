const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { debugLog } = require('./02-utilities');

async function loadCookies(allCookies) {
    try {
        debugLog('Loading cookies from all cookies*.json files');
        const files = glob.sync('cookies*.json', { cwd: process.cwd() });
        allCookies.length = 0; // Clear existing cookies
        for (const file of files) {
            const cookiesData = JSON.parse(await fs.readFile(path.join(process.cwd(), file), 'utf8'));
            allCookies.push(...cookiesData);
        }
        debugLog('Cookies loaded successfully', {
            files: files.length,
            totalCookies: allCookies.length
        });
    } catch (error) {
        debugLog('Error loading cookies:', error);
    }
}

module.exports = {
    loadCookies
}; 