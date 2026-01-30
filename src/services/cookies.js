const { pool } = require('../db/connection');
const fs = require('fs');
const path = require('path');

const cookiesCache = new Map(); // key: accountId (number), value: { cookies, timestamp }
const CACHE_TTL = 60000; // 1 minute

/**
 * Load cookies from database for an account
 */
async function loadCookiesFromDB(accountId) {
  if (accountId == null) return null;
  try {
    const result = await pool.query(
      'SELECT id, name, value, domain, path, expires, httpOnly, secure, sameSite FROM cookies WHERE account_id = $1 ORDER BY domain, name',
      [accountId]
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      value: row.value,
      domain: row.domain,
      path: row.path || '/',
      expires: row.expires ? Math.floor(new Date(row.expires).getTime() / 1000) : undefined,
      httpOnly: row.httpOnly || false,
      secure: row.secure || false,
      sameSite: row.sameSite || 'Lax',
    }));
  } catch (error) {
    console.error('Error loading cookies from database:', error);
    return null;
  }
}

/**
 * Load cookies from file (fallback)
 */
function loadCookiesFromFile() {
  try {
    const cookieDir = path.join(__dirname, '..');
    const cookieFiles = fs.readdirSync(cookieDir).filter(f => f.startsWith('cookies') && f.endsWith('.json'));
    const cookies = [];
    
    for (const file of cookieFiles) {
      try {
        const filePath = path.join(cookieDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data)) {
          cookies.push(...data);
        }
      } catch (e) {
        console.warn(`Failed to load cookie file ${file}:`, e.message);
      }
    }
    
    return cookies;
  } catch (error) {
    console.error('Error loading cookies from file:', error);
    return [];
  }
}

/**
 * Get cookies for an account (from database with file fallback when accountId is null and DB fails)
 * @param {number|null} accountId - Account ID; when null, returns [] (caller should pass default account id)
 */
async function getCookies(accountId) {
  if (accountId == null) return [];

  const now = Date.now();
  const cached = cookiesCache.get(accountId);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.cookies;
  }

  let cookies = await loadCookiesFromDB(accountId);
  if (cookies === null) {
    console.warn('Database cookies unavailable for account', accountId);
    return [];
  }

  cookiesCache.set(accountId, { cookies, timestamp: now });
  return cookies;
}

/**
 * Invalidate cookies cache (all accounts or a specific account)
 */
function invalidateCache(accountId) {
  if (accountId != null) {
    cookiesCache.delete(accountId);
  } else {
    cookiesCache.clear();
  }
}

/**
 * Normalize cookie data from various formats (browser extension, Puppeteer, etc.)
 */
function normalizeCookie(cookieData) {
  const normalized = {
    name: cookieData.name,
    value: cookieData.value,
    domain: cookieData.domain || null,
    path: cookieData.path || '/',
    httpOnly: cookieData.httpOnly || cookieData.httpOnly === true || false,
    secure: cookieData.secure || cookieData.secure === true || false,
    sameSite: 'Lax',
  };

  // Handle expirationDate (browser extension format) vs expires (Puppeteer format)
  if (cookieData.expirationDate !== undefined) {
    // Browser extension format: expirationDate is a Unix timestamp in seconds
    normalized.expires = cookieData.expirationDate ? Math.floor(cookieData.expirationDate) : null;
  } else if (cookieData.expires !== undefined) {
    // Puppeteer format: expires is already a Unix timestamp in seconds
    normalized.expires = cookieData.expires ? Math.floor(cookieData.expires) : null;
  } else {
    normalized.expires = null;
  }

  // Convert sameSite values
  if (cookieData.sameSite) {
    const sameSiteLower = cookieData.sameSite.toLowerCase();
    if (sameSiteLower === 'no_restriction' || sameSiteLower === 'none') {
      normalized.sameSite = 'None';
    } else if (sameSiteLower === 'strict') {
      normalized.sameSite = 'Strict';
    } else if (sameSiteLower === 'lax' || sameSiteLower === 'unspecified') {
      normalized.sameSite = 'Lax';
    } else {
      normalized.sameSite = 'Lax';
    }
  }

  // Handle session cookies (if expirationDate is missing or session is true)
  if (cookieData.session === true || (cookieData.expirationDate === undefined && cookieData.expires === undefined)) {
    normalized.expires = null;
  }

  return normalized;
}

/**
 * Create or update a cookie (cookieData must include accountId)
 */
async function upsertCookie(cookieData, userId) {
  const accountId = cookieData.accountId;
  if (accountId == null) {
    throw new Error('accountId is required for cookie');
  }
  const normalized = normalizeCookie(cookieData);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expires = normalized.expires ? new Date(normalized.expires * 1000) : null;

    if (cookieData.id) {
      await client.query(
        `UPDATE cookies 
         SET name = $1, value = $2, domain = $3, path = $4, expires = $5, httpOnly = $6, secure = $7, sameSite = $8, 
             updated_at = CURRENT_TIMESTAMP, updated_by = $9
         WHERE id = $10 AND account_id = $11`,
        [
          normalized.name,
          normalized.value,
          normalized.domain,
          normalized.path,
          expires,
          normalized.httpOnly,
          normalized.secure,
          normalized.sameSite,
          userId,
          cookieData.id,
          accountId,
        ]
      );
      await client.query('COMMIT');
      invalidateCache(accountId);
      return { success: true, id: cookieData.id, action: 'updated' };
    }

    const existing = await client.query(
      'SELECT id FROM cookies WHERE name = $1 AND domain = $2 AND account_id = $3',
      [normalized.name, normalized.domain, accountId]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE cookies 
         SET value = $1, path = $2, expires = $3, httpOnly = $4, secure = $5, sameSite = $6, 
             updated_at = CURRENT_TIMESTAMP, updated_by = $7
         WHERE id = $8`,
        [
          normalized.value,
          normalized.path,
          expires,
          normalized.httpOnly,
          normalized.secure,
          normalized.sameSite,
          userId,
          existing.rows[0].id,
        ]
      );
      await client.query('COMMIT');
      invalidateCache(accountId);
      return { success: true, id: existing.rows[0].id, action: 'updated' };
    }

    const result = await client.query(
      `INSERT INTO cookies (account_id, name, value, domain, path, expires, httpOnly, secure, sameSite, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        accountId,
        normalized.name,
        normalized.value,
        normalized.domain,
        normalized.path,
        expires,
        normalized.httpOnly,
        normalized.secure,
        normalized.sameSite,
        userId,
      ]
    );
    await client.query('COMMIT');
    invalidateCache(accountId);
    return { success: true, id: result.rows[0].id, action: 'created' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a cookie by ID (invalidates cache for the cookie's account)
 */
async function deleteCookie(cookieId) {
  try {
    const accountResult = await pool.query('SELECT account_id FROM cookies WHERE id = $1', [cookieId]);
    await pool.query('DELETE FROM cookies WHERE id = $1', [cookieId]);
    if (accountResult.rows.length > 0 && accountResult.rows[0].account_id) {
      invalidateCache(accountResult.rows[0].account_id);
    } else {
      invalidateCache();
    }
    return { success: true };
  } catch (error) {
    throw error;
  }
}

/**
 * Delete all cookies for an account (or all cookies if accountId not provided, for backward compat)
 */
async function deleteAllCookies(accountId) {
  try {
    if (accountId != null) {
      await pool.query('DELETE FROM cookies WHERE account_id = $1', [accountId]);
      invalidateCache(accountId);
    } else {
      await pool.query('DELETE FROM cookies');
      invalidateCache();
    }
    return { success: true };
  } catch (error) {
    throw error;
  }
}

/**
 * Migrate cookies from files to database (assigns to default account)
 */
async function migrateCookies() {
  const fileCookies = loadCookiesFromFile();
  if (fileCookies.length === 0) {
    console.log('No cookies found in files to migrate');
    return;
  }

  const defaultAccountResult = await pool.query('SELECT id FROM accounts WHERE is_default = true LIMIT 1');
  const defaultAccountId = defaultAccountResult.rows[0]?.id;
  if (!defaultAccountId) {
    console.warn('No default account found; skipping cookie file migration');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const cookie of fileCookies) {
      const existing = await client.query(
        'SELECT id FROM cookies WHERE name = $1 AND domain = $2 AND account_id = $3',
        [cookie.name, cookie.domain || null, defaultAccountId]
      );

      if (existing.rows.length === 0) {
        const expires = cookie.expires ? new Date(cookie.expires * 1000) : null;
        await client.query(
          `INSERT INTO cookies (account_id, name, value, domain, path, expires, httpOnly, secure, sameSite)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            defaultAccountId,
            cookie.name,
            cookie.value,
            cookie.domain || null,
            cookie.path || '/',
            expires,
            cookie.httpOnly || false,
            cookie.secure || false,
            cookie.sameSite || 'Lax',
          ]
        );
      }
    }

    await client.query('COMMIT');
    invalidateCache(defaultAccountId);
    console.log(`Migrated ${fileCookies.length} cookies from files to database`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error migrating cookies:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getCookies,
  upsertCookie,
  deleteCookie,
  deleteAllCookies,
  migrateCookies,
  invalidateCache,
};

