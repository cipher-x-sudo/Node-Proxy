# Admin Panel Setup

## Database Setup

The admin panel requires a PostgreSQL database. Set the following environment variables:

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=proxy_config
DB_USER=postgres
DB_PASSWORD=postgres
```

## Authentication

Default admin credentials (change immediately after first login):
- Username: `admin` (or set via `ADMIN_USERNAME` env var)
- Password: `admin123` (or set via `ADMIN_PASSWORD` env var)

## JWT Secret

Set a secure JWT secret in production:
```bash
JWT_SECRET=your-secure-secret-key-here
```

## Access

- Admin Panel: `http://localhost:3000/admin`
- Login Page: `http://localhost:3000/admin/login`

## Features

- **Dashboard**: View statistics and overview
- **Configuration**: Edit all proxy settings through web interface
- **History**: View configuration change history
- **Users**: Manage admin users

## Migration

On first run, the system will:
1. Initialize the database schema
2. Create default admin user
3. Migrate existing `config.js` values to database

After migration, configuration is stored in the database and can be edited through the web interface.

