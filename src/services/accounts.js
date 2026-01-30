const { pool } = require('../db/connection');

/**
 * Get account by slug (for path/header resolution)
 */
async function getAccountBySlug(slug) {
  try {
    const result = await pool.query(
      'SELECT id, name, slug, is_default, created_at, updated_at FROM accounts WHERE slug = $1',
      [slug]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting account by slug:', error);
    return null;
  }
}

/**
 * Get the default account (when no account is specified in request)
 */
async function getDefaultAccount() {
  try {
    const result = await pool.query(
      'SELECT id, name, slug, is_default, created_at, updated_at FROM accounts WHERE is_default = true LIMIT 1'
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting default account:', error);
    return null;
  }
}

/**
 * List all accounts (for admin)
 */
async function listAccounts() {
  try {
    const result = await pool.query(
      'SELECT id, name, slug, is_default, created_at, updated_at FROM accounts ORDER BY is_default DESC, name'
    );
    return result.rows;
  } catch (error) {
    console.error('Error listing accounts:', error);
    throw error;
  }
}

/**
 * Get account by ID
 */
async function getAccountById(id) {
  try {
    const result = await pool.query(
      'SELECT id, name, slug, is_default, created_at, updated_at FROM accounts WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting account by id:', error);
    return null;
  }
}

/**
 * Create a new account
 */
async function createAccount(name, slug) {
  try {
    const result = await pool.query(
      `INSERT INTO accounts (name, slug) VALUES ($1, $2)
       RETURNING id, name, slug, is_default, created_at, updated_at`,
      [name, slug]
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const e = new Error('An account with this slug already exists');
      e.code = 'DUPLICATE_SLUG';
      throw e;
    }
    throw error;
  }
}

/**
 * Update an account
 */
async function updateAccount(id, name, slug) {
  try {
    const result = await pool.query(
      `UPDATE accounts SET name = COALESCE($1, name), slug = COALESCE($2, slug), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, name, slug, is_default, created_at, updated_at`,
      [name, slug, id]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const e = new Error('An account with this slug already exists');
      e.code = 'DUPLICATE_SLUG';
      throw e;
    }
    throw error;
  }
}

/**
 * Set an account as the default (unsets others)
 */
async function setDefaultAccount(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE accounts SET is_default = false');
    const result = await client.query(
      `UPDATE accounts SET is_default = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1
       RETURNING id, name, slug, is_default, created_at, updated_at`,
      [id]
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete an account (cookies are cascade-deleted)
 */
async function deleteAccount(id) {
  try {
    const result = await pool.query('DELETE FROM accounts WHERE id = $1 RETURNING id', [id]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error deleting account:', error);
    throw error;
  }
}

module.exports = {
  getAccountBySlug,
  getDefaultAccount,
  listAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  setDefaultAccount,
  deleteAccount,
};
