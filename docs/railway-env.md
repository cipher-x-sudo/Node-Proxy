# Railway environment variables

Set these in **Railway** → your service → **Variables** (or **Settings** → **Environment**).

- **Proxy URL:** http://leonardo.anon404.me/
- **Target site:** leonardo.ai

Railway sets **PORT** and **DATABASE_URL** when you add a Postgres database.

---

## Required

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for admin JWT (use a long random string) | `openssl rand -hex 32` |
| `DATABASE_URL` | Postgres connection string (auto-set if you add Railway Postgres) | `postgresql://...?sslmode=require` |

---

## Admin panel (first login)

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_USERNAME` | Default admin username (only used when no users exist) | `admin` |
| `ADMIN_PASSWORD` | Default admin password (change after first login) | `admin123` |
| `JWT_EXPIRES_IN` | JWT token lifetime | `24h` |

---

## Proxy config

Set these or configure later in the Admin UI.

| Variable | Description | Default |
|----------|-------------|---------|
| `PROXY_DOMAIN` | Your proxy domain (host only, no scheme/slash) | `leonardo.anon404.me` |
| `TARGET_DOMAIN` | Target site to proxy | `leonardo.ai` |
| `PROXY_ENABLED` | Use upstream HTTP proxy for Puppeteer | `true` |
| `USER_AGENT` | Browser user agent string | (Chrome) |

---

## Upstream HTTP proxy

Used when `PROXY_ENABLED=true` for outbound Puppeteer traffic.

| Variable | Description | This setup |
|----------|-------------|------------|
| `HTTP_PROXY_HOST` | Proxy host | `161.77.103.115` |
| `HTTP_PROXY_PORT` | Proxy port | `44729` |
| `HTTP_PROXY_USERNAME` | Proxy username | (set in env block above) |
| `HTTP_PROXY_PASSWORD` | Proxy password | (set in env block above) |

---

## Database (only if not using Railway Postgres)

If you use an external Postgres instead of Railway’s:

| Variable | Description |
|----------|-------------|
| `DB_HOST` | Postgres host |
| `DB_PORT` | Postgres port (e.g. 5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |

---

## Ready-to-use env (leonardo.anon404.me → leonardo.ai)

Copy this block into Railway Variables. Replace the placeholders with your own values.

```env
# Required – generate with: openssl rand -hex 32
JWT_SECRET=REPLACE_WITH_OPENSSL_RAND_HEX_32

# Admin panel (first login)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
JWT_EXPIRES_IN=24h

# Proxy: your public URL → leonardo.ai (no http:// or trailing slash)
PROXY_DOMAIN=leonardo.anon404.me
TARGET_DOMAIN=leonardo.ai
PROXY_ENABLED=true

# Upstream HTTP proxy (Puppeteer outbound)
HTTP_PROXY_HOST=161.77.103.115
HTTP_PROXY_PORT=44729
HTTP_PROXY_USERNAME=7uFsqCYc65O2fmn
HTTP_PROXY_PASSWORD=3GHBXbTQT7S67Ll
```

**Database:** Add Postgres in Railway so it sets `DATABASE_URL` automatically.

**Security:** This file contains proxy credentials. Prefer setting them only in Railway Variables (not committing). If you commit, add `docs/railway-env.md` to `.gitignore` or remove the credentials from the file.
