const { pool } = require('../db/connection');
const fs = require('fs');
const path = require('path');

let cookiesCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 60000; // 1 minute

/**
 * Load cookies from database
 */
async function loadCookiesFromDB() {
  try {
    const result = await pool.query(
      'SELECT id, name, value, domain, path, expires, httpOnly, secure, sameSite FROM cookies ORDER BY domain, name'
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
 * Get cookies (from database with file fallback)
 */
async function getCookies() {
  // Check cache
  const now = Date.now();
  if (cookiesCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
    return cookiesCache;
  }

  // Try database first
  let cookies = await loadCookiesFromDB();
  
  // Fallback to file if database fails or returns empty
  if (!cookies || cookies.length === 0) {
    console.warn('Database cookies unavailable or empty, using file cookies');
    cookies = loadCookiesFromFile();
  }

  // Update cache
  cookiesCache = cookies;
  cacheTimestamp = now;

  return cookies;
}

/**
 * Invalidate cookies cache
 */
function invalidateCache() {
  cookiesCache = null;
  cacheTimestamp = null;
}

/**
 * Create or update a cookie
 */
async function upsertCookie(cookieData, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // If updating by ID, use that
    if (cookieData.id) {
      const expires = cookieData.expires ? new Date(cookieData.expires * 1000) : null;
      await client.query(
        `UPDATE cookies 
         SET name = $1, value = $2, domain = $3, path = $4, expires = $5, httpOnly = $6, secure = $7, sameSite = $8, 
             updated_at = CURRENT_TIMESTAMP, updated_by = $9
         WHERE id = $10`,
        [
          cookieData.name,
          cookieData.value,
          cookieData.domain || null,
          cookieData.path || '/',
          expires,
          cookieData.httpOnly || false,
          cookieData.secure || false,
          cookieData.sameSite || 'Lax',
          userId,
          cookieData.id,
        ]
      );
      await client.query('COMMIT');
      invalidateCache();
      return { success: true, id: cookieData.id, action: 'updated' };
    }

    // Check if cookie exists (by name and domain)
    const existing = await client.query(
      'SELECT id FROM cookies WHERE name = $1 AND domain = $2',
      [cookieData.name, cookieData.domain || null]
    );

    const expires = cookieData.expires ? new Date(cookieData.expires * 1000) : null;

    if (existing.rows.length > 0) {
      // Update existing cookie
      await client.query(
        `UPDATE cookies 
         SET value = $1, path = $2, expires = $3, httpOnly = $4, secure = $5, sameSite = $6, 
             updated_at = CURRENT_TIMESTAMP, updated_by = $7
         WHERE id = $8`,
        [
          cookieData.value,
          cookieData.path || '/',
          expires,
          cookieData.httpOnly || false,
          cookieData.secure || false,
          cookieData.sameSite || 'Lax',
          userId,
          existing.rows[0].id,
        ]
      );
      await client.query('COMMIT');
      invalidateCache();
      return { success: true, id: existing.rows[0].id, action: 'updated' };
    } else {
      // Insert new cookie
      const result = await client.query(
        `INSERT INTO cookies (name, value, domain, path, expires, httpOnly, secure, sameSite, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          cookieData.name,
          cookieData.value,
          cookieData.domain || null,
          cookieData.path || '/',
          expires,
          cookieData.httpOnly || false,
          cookieData.secure || false,
          cookieData.sameSite || 'Lax',
          userId,
        ]
      );
      await client.query('COMMIT');
      invalidateCache();
      return { success: true, id: result.rows[0].id, action: 'created' };
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a cookie
 */
async function deleteCookie(cookieId) {
  try {
    await pool.query('DELETE FROM cookies WHERE id = $1', [cookieId]);
    invalidateCache();
    return { success: true };
  } catch (error) {
    throw error;
  }
}

/**
 * Delete all cookies
 */
async function deleteAllCookies() {
  try {
    await pool.query('DELETE FROM cookies');
    invalidateCache();
    return { success: true };
  } catch (error) {
    throw error;
  }
}

/**
 * Migrate cookies from files to database
 */
async function migrateCookies() {
  const fileCookies = loadCookiesFromFile();
  if (fileCookies.length === 0) {
    console.log('No cookies found in files to migrate');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const cookie of fileCookies) {
      // Check if cookie already exists
      const existing = await client.query(
        'SELECT id FROM cookies WHERE name = $1 AND domain = $2',
        [cookie.name, cookie.domain || null]
      );

      if (existing.rows.length === 0) {
        const expires = cookie.expires ? new Date(cookie.expires * 1000) : null;
        await client.query(
          `INSERT INTO cookies (name, value, domain, path, expires, httpOnly, secure, sameSite)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
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
    invalidateCache();
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

