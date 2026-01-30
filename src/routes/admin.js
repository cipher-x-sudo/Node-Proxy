const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/connection');
const { requireAuth } = require('../auth/middleware');
const { getConfig, updateConfig, getConfigHistory, invalidateCache: invalidateConfigCache } = require('../services/config');
const { getCookies, upsertCookie, deleteCookie, deleteAllCookies, invalidateCache: invalidateCookieCache } = require('../services/cookies');
const {
  listAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  setDefaultAccount,
  deleteAccount,
  getDefaultAccount,
} = require('../services/accounts');

const router = express.Router();

// All admin routes require authentication
router.use(requireAuth);

/**
 * Get all configuration
 */
router.get('/config', async (req, res) => {
  try {
    const config = await getConfig();
    res.json({ config });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

/**
 * Update single config value
 */
router.put('/config/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }

    await updateConfig(key, value, req.user.userId);
    res.json({ success: true, message: 'Configuration updated' });
  } catch (error) {
    console.error('Update config error:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * Bulk update configuration
 */
router.post('/config/bulk', async (req, res) => {
  try {
    const { config: configUpdates } = req.body;

    if (!configUpdates || typeof configUpdates !== 'object') {
      return res.status(400).json({ error: 'Invalid configuration object' });
    }

    const updates = [];
    for (const [key, value] of Object.entries(configUpdates)) {
      try {
        await updateConfig(key, value, req.user.userId);
        updates.push({ key, success: true });
      } catch (error) {
        updates.push({ key, success: false, error: error.message });
      }
    }

    res.json({ success: true, updates });
  } catch (error) {
    console.error('Bulk update config error:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * Get configuration history
 */
router.get('/config/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = await getConfigHistory(limit);
    res.json({ history });
  } catch (error) {
    console.error('Get config history error:', error);
    res.status(500).json({ error: 'Failed to load configuration history' });
  }
});

/**
 * Get proxy statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const configCount = await pool.query('SELECT COUNT(*) FROM config');
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const historyCount = await pool.query('SELECT COUNT(*) FROM config_history');
    const accountCount = await pool.query('SELECT COUNT(*) FROM accounts');

    res.json({
      stats: {
        configEntries: parseInt(configCount.rows[0].count),
        users: parseInt(userCount.rows[0].count),
        historyEntries: parseInt(historyCount.rows[0].count),
        accounts: parseInt(accountCount.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to load statistics' });
  }
});

/**
 * List all accounts
 */
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await listAccounts();
    res.json({ accounts });
  } catch (error) {
    console.error('List accounts error:', error);
    res.status(500).json({ error: 'Failed to load accounts' });
  }
});

/**
 * Create a new account
 */
router.post('/accounts', async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }
    const slugClean = String(slug).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!slugClean) {
      return res.status(400).json({ error: 'Slug must be URL-safe' });
    }
    const account = await createAccount(name, slugClean);
    res.json({ success: true, account });
  } catch (error) {
    if (error.code === 'DUPLICATE_SLUG') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Create account error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

/**
 * Update an account
 */
router.put('/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid account ID' });
    const { name, slug } = req.body;
    const slugClean = slug != null ? String(slug).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-') : null;
    const account = await updateAccount(id, name, slugClean);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, account });
  } catch (error) {
    if (error.code === 'DUPLICATE_SLUG') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update account error:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

/**
 * Set account as default
 */
router.patch('/accounts/:id/default', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid account ID' });
    const account = await setDefaultAccount(id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, account });
  } catch (error) {
    console.error('Set default account error:', error);
    res.status(500).json({ error: 'Failed to set default account' });
  }
});

/**
 * Delete an account
 */
router.delete('/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid account ID' });
    const deleted = await deleteAccount(id);
    if (!deleted) return res.status(404).json({ error: 'Account not found' });
    invalidateCookieCache();
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

/**
 * Create new admin user
 */
router.post('/users', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, passwordHash]
    );

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

/**
 * Reload configuration cache
 */
router.post('/config/reload', async (req, res) => {
  try {
    invalidateConfigCache();
    await getConfig(); // Reload
    res.json({ success: true, message: 'Configuration cache reloaded' });
  } catch (error) {
    console.error('Reload config error:', error);
    res.status(500).json({ error: 'Failed to reload configuration' });
  }
});

/**
 * Get cookies for an account (query: accountId; if omitted, use default account)
 */
router.get('/cookies', async (req, res) => {
  try {
    let accountId = req.query.accountId != null ? parseInt(req.query.accountId, 10) : null;
    if (accountId == null || isNaN(accountId)) {
      const defaultAccount = await getDefaultAccount();
      accountId = defaultAccount ? defaultAccount.id : null;
    }
    const cookies = accountId ? await getCookies(accountId) : [];
    res.json({ cookies });
  } catch (error) {
    console.error('Get cookies error:', error);
    res.status(500).json({ error: 'Failed to load cookies' });
  }
});

/**
 * Create or update a cookie (body must include accountId)
 */
router.post('/cookies', async (req, res) => {
  try {
    const cookieData = req.body;
    if (!cookieData.name || !cookieData.value) {
      return res.status(400).json({ error: 'Cookie name and value are required' });
    }
    if (cookieData.accountId == null) {
      return res.status(400).json({ error: 'accountId is required' });
    }
    const result = await upsertCookie(cookieData, req.user.userId);
    invalidateCookieCache(cookieData.accountId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Upsert cookie error:', error);
    res.status(500).json({ error: 'Failed to save cookie' });
  }
});

/**
 * Update a cookie by ID (body may include accountId for the cookie's account)
 */
router.put('/cookies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cookieData = req.body;
    const existing = await pool.query('SELECT id, account_id FROM cookies WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cookie not found' });
    }
    const accountId = cookieData.accountId != null ? cookieData.accountId : existing.rows[0].account_id;
    const result = await upsertCookie({ ...cookieData, id, accountId }, req.user.userId);
    invalidateCookieCache(accountId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Update cookie error:', error);
    res.status(500).json({ error: 'Failed to update cookie' });
  }
});

/**
 * Delete a cookie
 */
router.delete('/cookies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteCookie(id);
    res.json({ success: true, message: 'Cookie deleted' });
  } catch (error) {
    console.error('Delete cookie error:', error);
    res.status(500).json({ error: 'Failed to delete cookie' });
  }
});

/**
 * Delete all cookies (query: accountId optional; if provided, delete only that account's cookies)
 */
router.delete('/cookies', async (req, res) => {
  try {
    const accountId = req.query.accountId != null ? parseInt(req.query.accountId, 10) : null;
    await deleteAllCookies(isNaN(accountId) ? null : accountId);
    invalidateCookieCache(accountId);
    res.json({ success: true, message: accountId ? 'Account cookies deleted' : 'All cookies deleted' });
  } catch (error) {
    console.error('Delete all cookies error:', error);
    res.status(500).json({ error: 'Failed to delete cookies' });
  }
});

/**
 * Bulk import cookies (body: cookies array, accountId required)
 */
router.post('/cookies/bulk', async (req, res) => {
  try {
    const { cookies, accountId } = req.body;
    if (!Array.isArray(cookies)) {
      return res.status(400).json({ error: 'Cookies must be an array' });
    }
    if (accountId == null) {
      return res.status(400).json({ error: 'accountId is required' });
    }
    const results = [];
    for (const cookie of cookies) {
      try {
        const result = await upsertCookie({ ...cookie, accountId }, req.user.userId);
        results.push({ cookie: cookie.name, ...result });
      } catch (error) {
        results.push({ cookie: cookie.name, success: false, error: error.message });
      }
    }
    invalidateCookieCache(accountId);
    res.json({ success: true, results });
  } catch (error) {
    console.error('Bulk import cookies error:', error);
    res.status(500).json({ error: 'Failed to import cookies' });
  }
});

module.exports = router;

