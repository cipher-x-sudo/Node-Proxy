const { pool } = require('../connection');
const config = require('../../config');

/**
 * Migrate existing config.js values to database
 */
async function migrateConfig() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Helper function to insert or update config
    const upsertConfig = async (key, value, type, description) => {
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await client.query(
        `INSERT INTO config (key, value, type, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, type = EXCLUDED.type, updated_at = CURRENT_TIMESTAMP`,
        [key, valueStr, type, description]
      );
    };

    // Migrate all config values
    await upsertConfig('proxyDomain', config.proxyDomain, 'string', 'Your proxy domain');
    await upsertConfig('targetDomain', config.targetDomain, 'string', 'The real target domain');
    await upsertConfig('tagsToOverride', JSON.stringify(config.tagsToOverride), 'array', 'HTML tags whose attributes will be rewritten');
    await upsertConfig('attributesToOverride', JSON.stringify(config.attributesToOverride), 'array', 'Attributes of tags that will be rewritten');
    await upsertConfig('proxyEnabled', config.proxyEnabled, 'boolean', 'Set to true to use an HTTP proxy');
    await upsertConfig('userAgent', config.userAgent, 'string', 'User agent string for browser automation');
    await upsertConfig('httpProxy.host', config.httpProxy.host, 'string', 'HTTP proxy host');
    await upsertConfig('httpProxy.port', config.httpProxy.port, 'number', 'HTTP proxy port');
    await upsertConfig('httpProxy.username', config.httpProxy.username, 'string', 'HTTP proxy username');
    await upsertConfig('httpProxy.password', config.httpProxy.password, 'string', 'HTTP proxy password');
    await upsertConfig('rewriteStatic', config.rewriteStatic, 'boolean', 'Enable/disable rewriting of static elements');
    await upsertConfig('injectS1', config.injectS1, 'boolean', 'Enable/disable injection of s1.js');
    await upsertConfig('skipRewriteDomains', JSON.stringify(config.skipRewriteDomains), 'array', 'Domains for which URL rewriting should be skipped');
    await upsertConfig('noCredentialsDomains', JSON.stringify(config.noCredentialsDomains), 'array', 'Domains for which credentials should NOT be sent');

    await client.query('COMMIT');
    console.log('Configuration migrated successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error migrating configuration:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateConfig()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrateConfig };

