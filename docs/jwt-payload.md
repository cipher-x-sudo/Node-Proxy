# Admin JWT – required payload

Tokens for `/api/admin/*` must be signed with your **JWT_SECRET** and contain the following payload.

## Required claims

| Claim     | Type   | Description                          |
|-----------|--------|--------------------------------------|
| `userId`  | number | Admin user ID (from `users.id`)      |
| `username`| string | Admin username (from `users.username`)|

## Standard claims (added by the app)

| Claim | Type   | Description        |
|-------|--------|--------------------|
| `iat` | number | Issued at (Unix s) |
| `exp` | number | Expires at (Unix s)|

## Example payload (decoded)

```json
{
  "userId": 1,
  "username": "admin",
  "iat": 1704067200,
  "exp": 1704153600
}
```

## How the app uses it

- **Issued by:** `POST /api/admin/auth/login` with valid username/password. The server calls `generateToken(user.id, user.username)` and returns the token (and sets `adminToken` cookie).
- **Accepted by:** All `/api/admin/*` routes (except `/api/admin/auth/login`). Middleware reads the token from:
  - `Authorization: Bearer <token>`, or
  - Cookie `adminToken`
- **After verify:** `req.user` is set to the decoded payload, so routes use `req.user.userId` and `req.user.username`.

## Validity

- **Signature:** Must be signed with the same `JWT_SECRET` as the server.
- **Expiry:** Default 24h (`JWT_EXPIRES_IN`). Expired tokens get `401 Invalid or expired token`.

## Summary

A valid admin JWT must have:

1. **Payload:** `userId` (number), `username` (string).
2. **Signature:** HMAC SHA-256 with your `JWT_SECRET`.
3. **Not expired:** `exp` &gt; current time.

Tokens from other systems (e.g. jwt.io examples with `sub`, `name`, `admin`) will not work; the app expects `userId` and `username` and verifies the signature with `JWT_SECRET`.
