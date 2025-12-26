const { pool } = require('../db/connection');
const fs = require('fs');
const path = require('path');

let configCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 60000; // 1 minute

/**
 * Load configuration from database
 */
async function loadConfigFromDB() {
  try {
    const result = await pool.query('SELECT key, value, type FROM config');
    const config = {};

    for (const row of result.rows) {
      let value = row.value;
      
      // Parse based on type
      if (row.type === 'array' || row.type === 'object') {
        try {
          value = JSON.parse(value);
        } catch (e) {
          console.warn(`Failed to parse ${row.key} as ${row.type}:`, e);
        }
      } else if (row.type === 'number') {
        value = parseFloat(value);
      } else if (row.type === 'boolean') {
        value = value === 'true' || value === '1';
      }

      // Handle nested keys like 'httpProxy.host'
      const keys = row.key.split('.');
      let current = config;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key];
      }
      current[keys[keys.length - 1]] = value;
    }

    return config;
  } catch (error) {
    console.error('Error loading config from database:', error);
    return null;
  }
}

/**
 * Load configuration from file (fallback)
 */
function loadConfigFromFile() {
  try {
    return require('../config');
  } catch (error) {
    console.error('Error loading config from file:', error);
    return null;
  }
}

/**
 * Get configuration (from database with file fallback, merged with env vars)
 */
async function getConfig() {
  // Check cache
  const now = Date.now();
  if (configCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
    return configCache;
  }

  // Try database first
  let config = await loadConfigFromDB();
  
  // Fallback to file if database fails
  if (!config) {
    console.warn('Database config unavailable, using file config');
    config = loadConfigFromFile();
  }

  // Merge with environment variables (env takes precedence)
  const mergedConfig = {
    proxyDomain: process.env.PROXY_DOMAIN || config?.proxyDomain || 'localhost:3000',
    targetDomain: process.env.TARGET_DOMAIN || config?.targetDomain || 'leonardo.ai',
    tagsToOverride: config?.tagsToOverride || ['img', 'link', 'script', 'iframe'],
    attributesToOverride: config?.attributesToOverride || ['href', 'src', 'content'],
    proxyEnabled: process.env.PROXY_ENABLED === 'true' || 
                  (process.env.PROXY_ENABLED === undefined ? (config?.proxyEnabled ?? true) : false),
    userAgent: process.env.USER_AGENT || config?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    httpProxy: {
      host: process.env.HTTP_PROXY_HOST || config?.httpProxy?.host || '86.109.93.239',
      port: parseInt(process.env.HTTP_PROXY_PORT || config?.httpProxy?.port || '12323', 10),
      username: process.env.HTTP_PROXY_USERNAME || config?.httpProxy?.username || 'huzaifaphan',
      password: process.env.HTTP_PROXY_PASSWORD || config?.httpProxy?.password || 'huzaifaphan',
    },
    rewriteStatic: config?.rewriteStatic || false,
    injectS1: config?.injectS1 || false,
    skipRewriteDomains: config?.skipRewriteDomains || ['consent.cookiefirst.com'],
    noCredentialsDomains: config?.noCredentialsDomains || [
      'app.launchdarkly.com',
      'events.launchdarkly.com',
      'c.adora-cdn.com',
      'consent.cookiefirst.com',
      'linkedin.com',
      'consent-eu.cookiefirst.com',
      'cookiefirst.com',
      'braze.com',
      'api.leonardo.ai',
    ],
  };

  // Update cache
  configCache = mergedConfig;
  cacheTimestamp = now;

  return mergedConfig;
}

/**
 * Invalidate config cache
 */
function invalidateCache() {
  configCache = null;
  cacheTimestamp = null;
}

/**
 * Update configuration value
 */
async function updateConfig(key, value, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Determine type
    let type = 'string';
    let valueStr = String(value);
    
    if (Array.isArray(value)) {
      type = 'array';
      valueStr = JSON.stringify(value);
    } else if (typeof value === 'object' && value !== null) {
      type = 'object';
      valueStr = JSON.stringify(value);
    } else if (typeof value === 'number') {
      type = 'number';
      valueStr = String(value);
    } else if (typeof value === 'boolean') {
      type = 'boolean';
      valueStr = String(value);
    }

    // Get old value for history
    const oldResult = await client.query('SELECT id, value FROM config WHERE key = $1', [key]);
    const oldValue = oldResult.rows.length > 0 ? oldResult.rows[0].value : null;
    const configId = oldResult.rows.length > 0 ? oldResult.rows[0].id : null;

    // Insert or update config
    const result = await client.query(
      `INSERT INTO config (key, value, type, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, type = EXCLUDED.type, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by
       RETURNING id`,
      [key, valueStr, type, userId]
    );

    const newConfigId = result.rows[0].id;

    // Add to history
    await client.query(
      `INSERT INTO config_history (config_id, old_value, new_value, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [newConfigId, oldValue, valueStr, userId]
    );

    await client.query('COMMIT');

    // Invalidate cache
    invalidateCache();

    return { success: true, configId: newConfigId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get configuration history
 */
async function getConfigHistory(limit = 50) {
  try {
    const result = await pool.query(
      `SELECT ch.id, ch.config_id, c.key, ch.old_value, ch.new_value, 
              ch.changed_at, u.username as changed_by
       FROM config_history ch
       JOIN config c ON ch.config_id = c.id
       LEFT JOIN users u ON ch.changed_by = u.id
       ORDER BY ch.changed_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting config history:', error);
    return [];
  }
}

module.exports = {
  getConfig,
  updateConfig,
  getConfigHistory,
  invalidateCache,
};

