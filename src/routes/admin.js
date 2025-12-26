const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/connection');
const { requireAuth } = require('../auth/middleware');
const { getConfig, updateConfig, getConfigHistory, invalidateCache } = require('../services/config');
const { getCookies, upsertCookie, deleteCookie, deleteAllCookies, invalidateCache } = require('../services/cookies');

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
    // Get basic stats
    const configCount = await pool.query('SELECT COUNT(*) FROM config');
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const historyCount = await pool.query('SELECT COUNT(*) FROM config_history');

    res.json({
      stats: {
        configEntries: parseInt(configCount.rows[0].count),
        users: parseInt(userCount.rows[0].count),
        historyEntries: parseInt(historyCount.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to load statistics' });
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
    invalidateCache();
    await getConfig(); // Reload
    res.json({ success: true, message: 'Configuration cache reloaded' });
  } catch (error) {
    console.error('Reload config error:', error);
    res.status(500).json({ error: 'Failed to reload configuration' });
  }
});

/**
 * Get all cookies
 */
router.get('/cookies', async (req, res) => {
  try {
    const cookies = await getCookies();
    res.json({ cookies });
  } catch (error) {
    console.error('Get cookies error:', error);
    res.status(500).json({ error: 'Failed to load cookies' });
  }
});

/**
 * Create or update a cookie
 */
router.post('/cookies', async (req, res) => {
  try {
    const cookieData = req.body;
    
    if (!cookieData.name || !cookieData.value) {
      return res.status(400).json({ error: 'Cookie name and value are required' });
    }

    const result = await upsertCookie(cookieData, req.user.userId);
    invalidateCache(); // Invalidate cache after update
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Upsert cookie error:', error);
    res.status(500).json({ error: 'Failed to save cookie' });
  }
});

/**
 * Update a cookie by ID
 */
router.put('/cookies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cookieData = req.body;

    // First check if cookie exists
    const existing = await pool.query('SELECT id FROM cookies WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cookie not found' });
    }

    const result = await upsertCookie({ ...cookieData, id }, req.user.userId);
    invalidateCache(); // Invalidate cache after update
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
 * Delete all cookies
 */
router.delete('/cookies', async (req, res) => {
  try {
    await deleteAllCookies();
    res.json({ success: true, message: 'All cookies deleted' });
  } catch (error) {
    console.error('Delete all cookies error:', error);
    res.status(500).json({ error: 'Failed to delete cookies' });
  }
});

/**
 * Bulk import cookies
 */
router.post('/cookies/bulk', async (req, res) => {
  try {
    const { cookies } = req.body;

    if (!Array.isArray(cookies)) {
      return res.status(400).json({ error: 'Cookies must be an array' });
    }

    const results = [];
    for (const cookie of cookies) {
      try {
        const result = await upsertCookie(cookie, req.user.userId);
        results.push({ cookie: cookie.name, ...result });
      } catch (error) {
        results.push({ cookie: cookie.name, success: false, error: error.message });
      }
    }

    invalidateCache(); // Invalidate cache after bulk import
    res.json({ success: true, results });
  } catch (error) {
    console.error('Bulk import cookies error:', error);
    res.status(500).json({ error: 'Failed to import cookies' });
  }
});

module.exports = router;

