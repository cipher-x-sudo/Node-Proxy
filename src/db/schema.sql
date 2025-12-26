-- Database schema for proxy configuration admin panel

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Configuration table
CREATE TABLE IF NOT EXISTS config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'string', -- string, number, boolean, array, object
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);

-- Configuration history table for audit trail
CREATE TABLE IF NOT EXISTS config_history (
    id SERIAL PRIMARY KEY,
    config_id INTEGER REFERENCES config(id) ON DELETE CASCADE,
    old_value TEXT,
    new_value TEXT NOT NULL,
    changed_by INTEGER REFERENCES users(id),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cookies table for storing cookies used by Puppeteer
CREATE TABLE IF NOT EXISTS cookies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    domain VARCHAR(255),
    path VARCHAR(255) DEFAULT '/',
    expires TIMESTAMP,
    httpOnly BOOLEAN DEFAULT false,
    secure BOOLEAN DEFAULT false,
    sameSite VARCHAR(20) DEFAULT 'Lax', -- Strict, Lax, None
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);
CREATE INDEX IF NOT EXISTS idx_config_history_config_id ON config_history(config_id);
CREATE INDEX IF NOT EXISTS idx_config_history_changed_at ON config_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_cookies_domain ON cookies(domain);
CREATE INDEX IF NOT EXISTS idx_cookies_name ON cookies(name);

