const { Pool } = require('pg');

// Parse DATABASE_URL if provided, otherwise use individual env vars
let poolConfig = {};

if (process.env.DATABASE_URL) {
  // Parse DATABASE_URL (format: postgresql://user:password@host:port/database)
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  };
} else {
  // Use individual environment variables
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'proxy_config',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

// Add pool settings
poolConfig.max = 20;
poolConfig.idleTimeoutMillis = 30000;
poolConfig.connectionTimeoutMillis = 2000;

// Database connection pool
const pool = new Pool(poolConfig);

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

