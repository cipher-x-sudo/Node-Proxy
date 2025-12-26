const { Pool } = require('pg');

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'proxy_config',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Initialize database schema
async function initializeDatabase() {
  try {
    const fs = require('fs');
    const path = require('path');
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schemaSQL);
    console.log('Database schema initialized');
  } catch (error) {
    if (error.code === '42P07') {
      // Table already exists, that's fine
      console.log('Database schema already exists');
    } else {
      console.error('Error initializing database:', error);
      throw error;
    }
  }
}

module.exports = {
  pool,
  initializeDatabase,
};

