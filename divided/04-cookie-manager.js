const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { debugLog } = require('./02-utilities');

async function loadCookies(allCookies) {
    try {
        debugLog('Loading cookies from all cookies*.json files');
        
        // Look in parent directory (outside divided folder)
        const cookiesPath = path.join(__dirname, '../cookies*.json');
        const files = glob.sync(cookiesPath);
        
        allCookies.length = 0; // Clear existing cookies
        
        for (const file of files) {
            try {
                const cookiesData = JSON.parse(await fs.readFile(file, 'utf8'));
                allCookies.push(...cookiesData);
                debugLog(`Loaded ${cookiesData.length} cookies from ${path.basename(file)}`);
            } catch (error) {
                debugLog(`Error loading cookies from ${file}:`, error);
            }
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