# API Reference

Base URL: `http://localhost:3000/api`

All responses are JSON and use a consistent envelope. Every response also
includes an `X-Request-Id` header for tracing.

## Response envelope

**Success:**

```json
{ "success": true, "data": <payload>, "requestId": "…" }
```

**Error:**

```json
{ "success": false, "error": { "message": "…", "details": <optional> }, "requestId": "…" }
```

## Status codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 200  | OK                                                  |
| 201  | Created                                             |
| 400  | Bad request (e.g. invalid/expired reset token)      |
| 401  | Unauthorized (bad credentials / invalid token)      |
| 404  | Route not found                                     |
| 409  | Conflict (email already registered)                 |
| 422  | Validation failed (bad body/query)                  |
| 500  | Internal server error                               |

---

## Health

### `GET /api/health`

**200** → `{ "status": "ok", "uptime": 12.34 }`

---

## Auth

The auth flow uses a short-lived **access token** (JWT) plus a rotating,
long-lived **refresh token** (opaque; only its hash is stored server-side).

### `POST /api/auth/register`

Create an account and receive tokens.

**Body**

| Field      | Rules                          |
| ---------- | ------------------------------ |
| `name`     | required, 1–120 chars          |
| `email`    | required, valid email, unique  |
| `password` | required, 8–128 chars          |

**201**
```json
{
  "success": true,
  "data": {
    "user": { "id": "…", "name": "Ada", "email": "ada@example.com", "createdAt": "…", "updatedAt": "…" },
    "accessToken": "<jwt>",
    "refreshToken": "<opaque>"
  },
  "requestId": "…"
}
```

**Errors:** `422` invalid body · `409` email already registered

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"supersecret"}'
```

### `POST /api/auth/login`

**Body:** `email`, `password`

**200** → same shape as register (`user` + `accessToken` + `refreshToken`)

**Errors:** `401` invalid email or password · `422` invalid body

### `POST /api/auth/refresh`

Exchange a valid refresh token for a new pair. The presented refresh token is
**rotated** (single-use) — the old one stops working.

**Body:** `refreshToken`

**200** → `{ "accessToken": "<jwt>", "refreshToken": "<opaque>" }`

**Errors:** `401` invalid or expired refresh token

### `POST /api/auth/logout`

Revoke a refresh token server-side.

**Body:** `refreshToken`

**200** → `{ "message": "Logged out" }`

### `POST /api/auth/forgot-password`

Request a password-reset link. **Always returns 200**, whether or not the email
exists (no account enumeration). The reset link is emailed (logged by the stub
email service in dev). Outside production the raw token is also returned as
`resetToken` for testing.

**Body:** `email`

**200**
```json
{ "success": true, "data": { "message": "If an account with that email exists, a reset link has been sent", "resetToken": "<dev-only>" }, "requestId": "…" }
```

### `GET /api/auth/verify-forgot-password-token`

Check whether a reset token is valid and unexpired (e.g. before rendering the
reset form).

**Query:** `token`

**200** → `{ "valid": true }` (or `false`)

```bash
curl "http://localhost:3000/api/auth/verify-forgot-password-token?token=<token>"
```

### `POST /api/auth/reset-password`

Set a new password using a valid reset token. On success the token is consumed
and **all** of the user's refresh tokens are revoked (forcing re-login).

**Body**

| Field      | Rules                 |
| ---------- | --------------------- |
| `token`    | required              |
| `password` | required, 8–128 chars |

**200** → `{ "message": "Password has been reset" }`

**Errors:** `400` invalid or expired token · `422` invalid body

---

## Request tracing

Send your own correlation id and it is echoed back and used in all logs:

```bash
curl http://localhost:3000/api/health -H "X-Request-Id: my-trace-123"
# Response header: X-Request-Id: my-trace-123
```
