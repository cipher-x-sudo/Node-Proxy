const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/connection');
const { generateToken, requireAuth } = require('./middleware');

const router = express.Router();

/**
 * Login endpoint
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const result = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user.id, user.username);

    // Set cookie
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Logout endpoint
 */
router.post('/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true });
});

/**
 * Get current user info
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create default admin user if no users exist
 */
async function createDefaultAdmin() {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(result.rows[0].count);

    if (userCount === 0) {
      const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        [defaultUsername, passwordHash]
      );

      console.log(`Default admin user created: ${defaultUsername} / ${defaultPassword}`);
      console.log('⚠️  Please change the default password immediately!');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
}

module.exports = { router, createDefaultAdmin };

