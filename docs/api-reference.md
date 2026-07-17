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
| 400  | Bad request (e.g. invalid/expired reset token or OTP) |
| 401  | Unauthorized (bad credentials / invalid token)      |
| 403  | Forbidden (account not verified)                    |
| 404  | Route not found                                     |
| 409  | Conflict (email already registered)                 |
| 422  | Validation failed (bad body/query)                  |
| 429  | Too many requests (credential endpoint rate limit)  |
| 500  | Internal server error                               |
| 503  | Service unhealthy (health probe: DB unavailable)    |

---

## Health

### `GET /api/health`

Combined liveness + readiness probe. Reports `ok: 1` when the process is up
**and** Postgres is reachable, or `ok: -1` when the database is unavailable.
Suitable for both container/orchestrator liveness and readiness probes.

**200** → `{ "success": true, "data": { "ok": 1, "db": "up", "uptime": 12.34 }, "requestId": "…" }`

**503** → error envelope `{ "success": false, "error": { "message": "Service unhealthy: database unavailable", "details": { "ok": -1, "db": "down" } }, "requestId": "…" }`

---

## Auth

The auth flow uses a short-lived **access token** (JWT) plus a rotating,
long-lived **refresh token** (opaque; only its hash is stored server-side).

> **Rate limiting:** the credential endpoints (`register`, `login`,
> `forgot-password`, `reset-password`, `verify-otp`, `resend-otp`) are limited to
> **10 requests per 15 minutes** per client to blunt brute-force and enumeration.
> Exceeding the limit returns **429**. The limiter is disabled under
> `NODE_ENV=test`.

> **Email verification:** a new account is created unverified (`isVerified:
> false`). Registration emails a **6-digit OTP** (valid for `OTP_TTL_MINUTES`,
> default 10). The account must be verified via `POST /api/auth/verify-otp`
> before it can log in — `login` returns **403** for an unverified account.
> Outside production the OTP is also returned in the response as `otpDevCode`
> (and logged by the stub email service) so the flow can be exercised without a
> mail server.

> **Cookies vs. tokens:** `login` and `refresh` set both tokens as httpOnly
> `accessToken`/`refreshToken` cookies **and** return them in the JSON body —
> use whichever fits your client. Browser clients get CSRF-resistant,
> XSS-resistant storage for free (cookies are httpOnly and, in production,
> `Secure`/`SameSite=None` so a cross-origin frontend can use them with
> `credentials: 'include'`); non-browser clients (mobile, service-to-service)
> can ignore the cookies and use the returned tokens instead. `refresh` and
> `logout` accept the refresh token from **either** the cookie or the body —
> the cookie wins if both are present.

### `POST /api/auth/register`

Create an account. **Does not log the caller in** — no tokens are issued here;
the account starts unverified (`isVerified: false`) and a 6-digit verification
OTP is emailed. Verify via `POST /api/auth/verify-otp`, then call
`POST /api/auth/login` to obtain tokens.

**Body**

| Field       | Rules                          |
| ----------- | ------------------------------ |
| `firstName` | required, 1–120 chars          |
| `lastName`  | required, 1–120 chars          |
| `email`     | required, valid email, unique  |
| `password`  | required, 8–128 chars          |

**201** — no tokens are issued; `otpDevCode` is present only outside production.
```json
{
  "success": true,
  "data": {
    "user": { "id": "…", "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "isVerified": false, "createdAt": "…", "updatedAt": "…" },
    "otpDevCode": "042317"
  },
  "requestId": "…"
}
```

**Errors:** `422` invalid body · `409` email already registered · `429` too many requests

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","password":"supersecret"}'
```

### `POST /api/auth/verify-otp`

Verify an account with the emailed 6-digit OTP. Every failure — wrong code,
unknown email, already-verified account, or no active OTP — resolves to the
**same generic 400** so the endpoint reveals nothing about which accounts
exist (no enumeration). A wrong code counts against the attempt cap
(`OTP_MAX_ATTEMPTS`); once the cap is hit the code is discarded and the caller
must request a new one via `resend-otp`.

**Body**

| Field   | Rules                       |
| ------- | ---------------------------- |
| `email` | required, valid email        |
| `otp`   | required, 6-digit code        |

**200** → `{ "success": true, "data": { "verified": true }, "requestId": "…" }`

**Errors:** `400` invalid or expired code · `422` invalid body · `429` too many requests

```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","otp":"042317"}'
```

### `POST /api/auth/resend-otp`

Re-issue a verification OTP. **Always returns 200**, whether or not the
account exists or is already verified (no enumeration). A resend within
`OTP_RESEND_COOLDOWN_SECONDS` of the last one is a silent no-op.

**Body:** `email`

**200** — `otpDevCode` is present only outside production, and only when a new
code was actually issued (not on a no-op).
```json
{ "success": true, "data": { "message": "If the account exists and is unverified, a new code has been sent", "otpDevCode": "042317" }, "requestId": "…" }
```

**Errors:** `422` invalid body · `429` too many requests

### `POST /api/auth/login`

**Body:** `email`, `password`

**200** → same shape as register (`user` + `accessToken` + `refreshToken`),
**and** sets the `accessToken`/`refreshToken` httpOnly cookies.

**Errors:** `401` invalid email or password · `403` account not verified ·
`422` invalid body

### `POST /api/auth/refresh`

Exchange a valid refresh token for a new pair. The presented refresh token is
**rotated** (single-use) — the old one stops working. Reads the refresh token
from the `refreshToken` cookie if present, otherwise from the body.

**Body:** `refreshToken` (optional if the cookie is present)

**200** → `{ "accessToken": "<jwt>", "refreshToken": "<opaque>" }`, and re-sets
the rotated httpOnly cookies.

**Errors:** `401` invalid/expired refresh token, or missing from both cookie and body

### `POST /api/auth/logout`

Revoke a refresh token server-side and clear both auth cookies. Reads the
refresh token from the `refreshToken` cookie if present, otherwise from the
body.

**Body:** `refreshToken` (optional if the cookie is present)

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

### `GET /api/auth/me`

Return the authenticated user. **Protected** — send the access token either as
a Bearer token in the `Authorization` header, or rely on the `accessToken`
cookie set by `login`/`refresh` (the header takes precedence if both are sent).

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**200**
```json
{
  "success": true,
  "data": { "user": { "id": "…", "firstName": "Jane", "lastName": "Doe", "email": "jane.doe@example.com", "isVerified": true, "createdAt": "…", "updatedAt": "…" } },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid Authorization header or expired access token

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

---

## Blockchains

Read-only reference data for supported chains — seeded/managed out of band,
not created or edited through this API.

### `GET /api/blockchains`

**Protected** — send the access token as a Bearer token or rely on the
`accessToken` cookie (same as `/api/auth/me`).

**Query**

| Field       | Rules                                              |
| ----------- | --------------------------------------------------- |
| `search`    | optional, 1–120 chars — case-insensitive partial match on `name` or `symbol` |
| `chainType` | optional — one of `evm`, `ton`, `solana`, `tron`, `aptos`, `sui` |
| `page`      | optional positive integer, default `1`             |
| `limit`     | optional positive integer (max `100`), default `10` |

**200**
```json
{
  "success": true,
  "data": {
    "data": [
      { "id": "…", "name": "Ethereum", "symbol": "ETH", "icon": null, "rpc": null, "explorer": null, "walletProvider": null, "order": null, "chainId": null, "startBlock": null, "isTestnet": false, "chainType": "evm", "isEnabled": null, "createdAt": "…", "updatedAt": "…" }
    ],
    "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1, "hasNextPage": false, "hasPrevPage": false }
  },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid access token · `422` invalid query (e.g. an unrecognized `chainType`)

```bash
curl "http://localhost:3000/api/blockchains?search=eth&chainType=evm&page=1&limit=10" \
  -H "Authorization: Bearer <accessToken>"
```

---

## Request tracing

Send your own correlation id and it is echoed back and used in all logs:

```bash
curl http://localhost:3000/api/health -H "X-Request-Id: my-trace-123"
# Response header: X-Request-Id: my-trace-123
```
