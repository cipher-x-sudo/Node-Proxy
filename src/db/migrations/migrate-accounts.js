const { pool } = require('../connection');

/**
 * Migrate to multi-account support: create accounts table, add account_id to cookies,
 * create default account, assign existing cookies to default account.
 */
async function migrateAccounts() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure accounts table exists (for very old deployments)
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Add account_id to cookies if missing (existing deployments)
    const hasColumn = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cookies' AND column_name = 'account_id'
    `);
    if (hasColumn.rows.length === 0) {
      await client.query(`
        ALTER TABLE cookies
        ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE
      `);
      await client.query('CREATE INDEX IF NOT EXISTS idx_cookies_account_id ON cookies(account_id)');
    }

    // 3. Create default account if no accounts exist
    const countResult = await client.query('SELECT COUNT(*) FROM accounts');
    if (parseInt(countResult.rows[0].count, 10) === 0) {
      await client.query(
        `INSERT INTO accounts (name, slug, is_default) VALUES ('Default', 'default', true)`
      );
    } else {
      // Ensure at least one account is default
      const defaultCount = await client.query('SELECT COUNT(*) FROM accounts WHERE is_default = true');
      if (parseInt(defaultCount.rows[0].count, 10) === 0) {
        await client.query(
          `UPDATE accounts SET is_default = true WHERE id = (SELECT id FROM accounts ORDER BY id LIMIT 1)`
        );
      }
    }

    // 4. Assign cookies with null account_id to the default account
    const defaultAccount = await client.query('SELECT id FROM accounts WHERE is_default = true LIMIT 1');
    if (defaultAccount.rows.length > 0) {
      const defaultId = defaultAccount.rows[0].id;
      await client.query('UPDATE cookies SET account_id = $1 WHERE account_id IS NULL', [defaultId]);
    }

    await client.query('COMMIT');
    console.log('Accounts migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error migrating accounts:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateAccounts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { migrateAccounts };
