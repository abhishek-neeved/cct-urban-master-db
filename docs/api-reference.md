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
| 400  | Bad request (e.g. invalid/expired verification code) |
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
**and** MongoDB is reachable, or `ok: -1` when the database is unavailable.
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

> **Login lockout:** on top of the per-IP limiter above, wrong passwords are
> also tracked **per email** (not per account) — including emails that aren't
> registered at all, so lockout behavior can never be used to tell a real
> email apart from a made-up one. After 5 consecutive wrong passwords that
> email is locked for `LOGIN_LOCKOUT_MINUTES` (default 15) — a locked login
> gets the same generic **401** as a wrong password, with nothing disclosed
> about the lock or whether the email is registered.

> **Refresh token theft detection:** rotating a refresh token doesn't delete it
> outright — it's marked used and kept until it expires. If an already-rotated
> token is ever presented again (a signal it was copied before rotation), every
> token issued from that login is revoked immediately, so both the legitimate
> client and any attacker holding a copy must log in again. A replay within a
> short grace window (~1s) of the rotation is instead treated as a benign race
> (e.g. two requests firing close together) and just gets a plain 401, without
> revoking anything — so a client that double-submits a refresh occasionally
> isn't logged out for it.

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

| Field       | Rules                                                                   |
| ----------- | ------------------------------------------------------------------------ |
| `firstName` | required, 1–120 chars                                                   |
| `lastName`  | required, 1–120 chars                                                   |
| `email`     | required, valid email, unique                                          |
| `password`  | required, 8–128 chars                                                   |
| `role`      | required, one of `service_provider`, `customer` (the signup account-type choice — "provide a service" vs. "book a service"; `admin` is never self-registered) |

**201** — no tokens are issued; `otpDevCode` is present only outside production.
```json
{
  "success": true,
  "data": {
    "user": { "id": "…", "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "role": "customer", "isVerified": false, "createdAt": "…", "updatedAt": "…" },
    "otpDevCode": "042317"
  },
  "requestId": "…"
}
```

**Errors:** `422` invalid body · `409` email already registered · `429` too many requests

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","password":"supersecret","role":"customer"}'
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

**Errors:** `401` invalid email or password, **or** the account is temporarily
locked out (same message either way — see "Login lockout" above) · `403`
account not verified · `422` invalid body

### `POST /api/auth/refresh`

Exchange a valid refresh token for a new pair. The presented refresh token is
**rotated** (single-use) — the old one stops working. Reads the refresh token
from the `refreshToken` cookie if present, otherwise from the body.

If the presented token has *already* been rotated out (replay — see
"Refresh token theft detection" above), every token from that login is
revoked and the caller gets the same 401 as any other invalid token.

**Body:** `refreshToken` (optional if the cookie is present)

**200** → `{ "accessToken": "<jwt>", "refreshToken": "<opaque>" }`, and re-sets
the rotated httpOnly cookies.

**Errors:** `401` invalid/expired refresh token, a replayed (already-rotated)
token, or missing from both cookie and body

### `POST /api/auth/logout`

Revoke a refresh token server-side and clear both auth cookies. Reads the
refresh token from the `refreshToken` cookie if present, otherwise from the
body.

**Body:** `refreshToken` (optional if the cookie is present)

**200** → `{ "message": "Logged out" }`

### `POST /api/auth/forgot-password`

Request a password-reset OTP. **Always returns 200**, whether or not the email
exists (no account enumeration). The 6-digit code is emailed (logged by the
stub email service in dev), reusing the same OTP infrastructure as
registration but scoped to its own `RESET` type — it can never collide with,
or be consumed by, a pending registration OTP for the same user. Outside
production the raw code is also returned as `otpDevCode` for testing.

**Body:** `email`

**200**
```json
{ "success": true, "data": { "message": "If an account with that email exists, a verification code has been sent", "otpDevCode": "<dev-only>" }, "requestId": "…" }
```

### `POST /api/auth/reset-password`

Set a new password using the emailed OTP. **One-shot** — the OTP itself is
both the proof of mailbox ownership and the authorization to set the new
password; there is no separate verify-then-reset step. Every failure (wrong
code, unknown email, no active reset OTP) resolves to the same generic 400
(no enumeration), and a wrong code counts against the same attempt cap as
registration OTPs — once exhausted, request a fresh code via
`forgot-password` again. On success the OTP is consumed and **all** of the
user's refresh tokens are revoked (forcing re-login).

**Body**

| Field      | Rules                  |
| ---------- | ----------------------- |
| `email`    | required, valid email   |
| `otp`      | required, 6-digit code  |
| `password` | required, 8–128 chars   |

**200** → `{ "message": "Password has been reset" }`

**Errors:** `400` invalid or expired verification code · `422` invalid body · `429` too many requests

```bash
curl -X POST http://localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","otp":"042317","password":"brand-new-password"}'
```

### `GET /api/auth/me`

Return the authenticated user. **Protected** — send the access token either as
a Bearer token in the `Authorization` header, or rely on the `accessToken`
cookie set by `login`/`refresh` (the header takes precedence if both are sent).

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**200**
```json
{
  "success": true,
  "data": { "user": { "id": "…", "firstName": "Jane", "lastName": "Doe", "email": "jane.doe@example.com", "role": "customer", "isVerified": true, "createdAt": "…", "updatedAt": "…" } },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid Authorization header or expired access token

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

---

## Users

Profile reads/updates that don't belong to auth's credential/session scope.
Operates on the same user record as `/api/auth/*` — `GET /api/users/me` is a
superset of `GET /api/auth/me`, kept as a separate module boundary for
profile-shaped concerns (and future fields like a profile photo) as they're
added.

Every user carries a **`role`** — `"service_provider"` or `"customer"`, set
directly at registration from the signup account-type choice ("provide a
service" vs. "book a service"), or `"admin"`, which is never self-registered —
promoting a user to `admin` is a direct data change today, until an admin
management endpoint exists. Role-gated routes look the role up fresh on every
request rather than trusting a claim embedded in the access token, so a role
change takes effect on the very next request instead of waiting out the
token's remaining lifetime.

### `GET /api/users/me`

Return the authenticated user's profile, including `role`. **Protected** — same
Bearer/cookie rules as `GET /api/auth/me`.

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**200**
```json
{
  "success": true,
  "data": { "user": { "id": "…", "firstName": "Jane", "lastName": "Doe", "email": "jane.doe@example.com", "role": "customer", "isVerified": true, "createdAt": "…", "updatedAt": "…" } },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid access token · `404` user no longer exists

### `PATCH /api/users/me`

Update the authenticated user's `firstName`/`lastName`. At least one field is
required.

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**Body**

| Field       | Rules                                             |
| ----------- | -------------------------------------------------- |
| `firstName` | optional, 1–120 chars                              |
| `lastName`  | optional, 1–120 chars                              |
|             | at least one of `firstName`/`lastName` is required |

**200** → `{ "success": true, "data": { "user": { …, "firstName": "Grace" } }, "requestId": "…" }`

**Errors:** `401` missing/invalid access token · `404` user no longer exists · `422` invalid body (including an empty body)

```bash
curl -X PATCH http://localhost:3000/api/users/me \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Grace"}'
```

---

## Uploads

Presigned S3 (or any S3-compatible provider — MinIO locally, see
`docker-compose.yml`) upload/view URLs. **Files never transit this server**:
the client PUTs bytes directly to `uploadUrl`, and reads go through a
short-lived presigned GET rather than a public bucket URL, so uploaded
documents stay private by default.

Every object key is `<purpose>/<userId>/<uuid>` — the owner is embedded in the
key itself (not just protected by the UUID being unguessable), which is what
lets `GET /api/uploads/view` reject one user reading another user's file with
a real authorization check rather than obscurity alone.

> **Presign, then upload, then submit:** call `presign` to get a URL, PUT the
> raw file bytes to that URL with the **same** `Content-Type`, then pass the
> returned `key` along with whatever resource the file belongs to (e.g. a KYC
> submission's `aadharImageKey`). The upload itself never goes through
> `/api/*` — only the presign call and the final submission using the key do.

### `POST /api/uploads/presign`

Get a short-lived presigned URL (`S3_PRESIGNED_URL_TTL_SECONDS`, default 300s)
to upload a file directly to object storage. **Protected.**

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**Body**

| Field         | Rules                                                     |
| ------------- | ---------------------------------------------------------- |
| `purpose`     | required, one of `kyc-aadhar`, `kyc-pan`, `kyc-photo`      |
| `contentType` | required, one of `image/jpeg`, `image/png`, `application/pdf` |

**200**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://<bucket>.s3.<region>.amazonaws.com/kyc-aadhar/<userId>/<uuid>?X-Amz-...",
    "key": "kyc-aadhar/<userId>/<uuid>",
    "expiresIn": 300
  },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid access token · `422` invalid body (unrecognised `purpose`/`contentType`)

```bash
curl -X POST http://localhost:3000/api/uploads/presign \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"purpose":"kyc-aadhar","contentType":"image/jpeg"}'

# Then, using the returned uploadUrl:
curl -X PUT "<uploadUrl>" -H "Content-Type: image/jpeg" --data-binary @aadhar.jpg
```

### `GET /api/uploads/view`

Get a short-lived presigned URL to view a previously uploaded file. **Protected**
— and further scoped to the caller: a key belonging to a different user gets
**403**, not the file.

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**Query:** `key` (the value returned by `presign`)

**200** → `{ "success": true, "data": { "viewUrl": "https://..." }, "requestId": "…" }`

**Errors:** `401` missing/invalid access token · `403` the key does not belong to the caller · `422` missing `key`

```bash
curl "http://localhost:3000/api/uploads/view?key=kyc-aadhar/<userId>/<uuid>" \
  -H "Authorization: Bearer <accessToken>"
```

---

## KYC

Identity verification: submit Aadhar/PAN/photograph, then wait for admin
review. The state machine has exactly one loop-back edge:

```
not_started ──submit──▶ pending ──approve──▶ verified (terminal)
                 ▲          │
                 └─reject───┘
```

`not_started` has no document in the database — it's the default `GET
/api/kyc/me` returns when the user has never submitted. A rejection can
always be resubmitted (clearing the previous `rejectionReason` and
re-entering the queue as `pending`); `verified` is terminal — there is no
un-verify today.

> **Image fields are S3 keys, not files.** `aadharImageKey`, `panImageKey`,
> and `photographKey` are object keys returned by `POST /api/uploads/presign`
> (see the Uploads section above) — upload the files there first, then submit
> their keys here.

### `GET /api/kyc/me`

Return the authenticated user's KYC status and, once submitted, their data.
**Protected.**

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**200** (before any submission)
```json
{ "success": true, "data": { "status": "not_started" }, "requestId": "…" }
```

**200** (after submission)
```json
{
  "success": true,
  "data": {
    "status": "pending",
    "aadharNumber": "123456789012",
    "aadharImageKey": "kyc-aadhar/<userId>/<uuid>",
    "panNumber": "ABCDE1234F",
    "panImageKey": "kyc-pan/<userId>/<uuid>",
    "address": "221B Baker Street",
    "photographKey": "kyc-photo/<userId>/<uuid>",
    "submittedAt": "…"
  },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid access token

### `POST /api/kyc/submit`

Submit (or resubmit, after a rejection) identity documents for review.

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**Body**

| Field            | Rules                                          |
| ---------------- | ------------------------------------------------ |
| `aadharNumber`   | required, exactly 12 digits                    |
| `aadharImageKey` | required — key from `POST /api/uploads/presign` |
| `panNumber`      | required, format `ABCDE1234F`                  |
| `panImageKey`    | required — key from `POST /api/uploads/presign` |
| `dateOfBirth`    | optional, ISO date                             |
| `address`        | required                                       |
| `photographKey`  | required — key from `POST /api/uploads/presign` |
| `uan`            | optional, exactly 14 digits if present         |

**200** → the updated record, `status: "pending"`

**Errors:** `400` already verified, or already pending review · `401` missing/invalid access token · `422` invalid body

```bash
curl -X POST http://localhost:3000/api/kyc/submit \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "aadharNumber":"123456789012","aadharImageKey":"kyc-aadhar/u1/a1",
    "panNumber":"ABCDE1234F","panImageKey":"kyc-pan/u1/a2",
    "address":"221B Baker Street","photographKey":"kyc-photo/u1/a3"
  }'
```

### Admin review

Everything below requires **both** a valid access token **and** the caller's
`role` being `admin` (see the Users section above — roles are looked up fresh
on every request). A non-admin gets **403**. There is no self-service way to
become an admin today; it's a direct data change (`role: "admin"` on the user
document) until an admin-management endpoint exists.

#### `GET /api/admin/kyc`

List submissions for review, optionally filtered by status.

**Headers:** `Authorization: Bearer <accessToken>` (admin)

**Query:** `status` (optional — one of `pending`, `verified`, `rejected`; omit for all)

**200** → `{ "success": true, "data": { "records": [ { "id": "…", "userId": "…", "status": "pending", … } ] }, "requestId": "…" }`

**Errors:** `401` missing/invalid access token · `403` caller is not an admin · `422` invalid `status`

#### `PATCH /api/admin/kyc/:userId/approve`

Approve a pending submission. Rejects with **400** if the submission isn't
currently `pending` (e.g. already verified, or never submitted at all — that
case is **404** instead).

**Headers:** `Authorization: Bearer <accessToken>` (admin)

**200** → the updated record, `status: "verified"`

**Errors:** `400` not pending · `401` missing/invalid access token · `403` caller is not an admin · `404` no submission for this user

#### `PATCH /api/admin/kyc/:userId/reject`

Reject a pending submission with a reason. Same pending-only rule as approve.

**Headers:** `Authorization: Bearer <accessToken>` (admin)

**Body:** `reason` (required, non-empty)

**200** → the updated record, `status: "rejected"`, `rejectionReason` set

**Errors:** `400` not pending · `401` missing/invalid access token · `403` caller is not an admin · `404` no submission for this user · `422` missing `reason`

```bash
curl -X PATCH http://localhost:3000/api/admin/kyc/<userId>/reject \
  -H "Authorization: Bearer <adminAccessToken>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Aadhar photo is blurry and unreadable"}'
```

---

## Onboarding Fee

A one-time ₹10 payment via a Razorpay Payment Link — no plan, no recurring
charge, no cancellation. Once paid, it's permanent: there is no repayment or
expiry for an account that has already paid. Status collapses to 2
client-facing states:

| Client status | Razorpay payment-link states it covers |
| -------------- | -------------------------- |
| `unpaid`       | no checkout yet, or one in progress/lapsed (`created`, `partially_paid`, `cancelled`, `expired`) |
| `paid`         | `paid` — permanent, never reverts |

> **Status changes via two independent, equally-trusted paths.** `POST
> /api/onboarding-fee/checkout` creates the Razorpay payment link and returns
> a URL for the client to open (new tab on web, in-app browser on mobile) to
> pay — it does **not** mark the fee paid. Only `GET
> /api/onboarding-fee/callback` (the redirect Razorpay sends the browser to
> after payment, verified via a signature over its query params) and `POST
> /api/onboarding-fee/webhook` (verified against Razorpay's own webhook
> signature) are trusted to mark it paid. A client claiming "payment
> succeeded" is not proof of payment; a Razorpay-signed confirmation is.
> Whichever of the two arrives first wins; the other is then a no-op.

### `GET /api/onboarding-fee/me`

Return the authenticated user's onboarding-fee payment status. **Protected.**

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**200**
```json
{
  "success": true,
  "data": { "status": "paid", "amountInRupees": 10, "paidAt": "…" },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid access token

### `POST /api/onboarding-fee/checkout`

Start a one-time onboarding-fee payment. Creates a Razorpay payment link and
returns its short URL for the client to open and complete payment.

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**Body:** `redirectUrl` (required) — where the client wants to land after
paying; the callback route redirects here once confirmed.

**200** → `{ "success": true, "data": { "shortUrl": "https://rzp.io/i/…" }, "requestId": "…" }`

**Errors:** `401` missing/invalid access token · `409` already paid

### `GET /api/onboarding-fee/callback`

Razorpay redirects the user's browser here after payment, with a signed set
of query params appended to the `callback_url` set at checkout. **Not**
gated by a user session; its trust boundary is the signature check below. On
success, redirects on to the `redirectUrl` supplied at checkout.

> **Signature verification.** Razorpay signs `payment_link_id|payment_link_reference_id|payment_link_status|razorpay_payment_id`
> with HMAC-SHA256 using the API key secret (`RAZORPAY_KEY_SECRET`) — a
> different scheme than the webhook's. A missing or invalid signature is
> rejected with **401**.

**Query params:** `razorpay_payment_id`, `razorpay_payment_link_id`, `razorpay_payment_link_reference_id`, `razorpay_payment_link_status`, `razorpay_signature`, `redirectUrl`

**302** → redirects to `redirectUrl`

**Errors:** `400` payment not completed, or no matching checkout found · `401` invalid callback signature

### `POST /api/onboarding-fee/webhook`

Razorpay's webhook for payment-link lifecycle events — a durable backup
confirmation path alongside the callback redirect (in case the browser
never completes the redirect, e.g. the app was killed mid-payment). **Not**
gated by a user session; its trust boundary is the signature check below.

> **Signature verification.** Razorpay signs the raw request body with
> HMAC-SHA256 using the webhook secret configured on both sides
> (`RAZORPAY_WEBHOOK_SECRET`), sent as the `X-Razorpay-Signature` header. A
> missing or invalid signature is rejected with **401** before the body is
> ever read as an event. A validly signed event for a payment link this app
> doesn't recognise (e.g. a webhook misconfigured for a different account) is
> logged and ignored — still **200**, so Razorpay doesn't endlessly retry.

**Headers:** `X-Razorpay-Signature: <hex hmac>`

**Body:** the raw Razorpay webhook payload (unvalidated beyond signature — this app reads only `event` and `payload.payment_link.entity`)

**200** → `{ "success": true, "data": { "received": true }, "requestId": "…" }` (event applied or ignored)

**Errors:** `401` invalid or missing signature

```bash
BODY='{"event":"payment_link.paid","payload":{"payment_link":{"entity":{"id":"plink_abc","status":"paid"}}}}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST http://localhost:3000/api/onboarding-fee/webhook \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: $SIGNATURE" \
  -d "$BODY"
```

---

## Criminal Record

A criminal-record check status. **There is no user-facing submission** —
the check itself happens outside this app (a real background-check vendor
integration is deferred); an admin records the outcome directly. `pending`
is the default until an admin sets a result.

### `GET /api/criminal-record/me`

Return the authenticated user's criminal-record check status. **Protected.**

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**200** (before any admin action)
```json
{ "success": true, "data": { "status": "pending" }, "requestId": "…" }
```

**Errors:** `401` missing/invalid access token

### `PATCH /api/admin/criminal-record/:userId`

Set a user's criminal-record check result. **Admin only** — same role-gating as KYC's admin routes (see the KYC section above).

**Headers:** `Authorization: Bearer <accessToken>` (admin)

**Body:** `status` (required, one of `pending`, `clear`, `flagged`)

**200** → `{ "success": true, "data": { "status": "clear", "checkedAt": "…" }, "requestId": "…" }`

**Errors:** `401` missing/invalid access token · `403` caller is not an admin · `422` invalid body/`userId`

```bash
curl -X PATCH http://localhost:3000/api/admin/criminal-record/<userId> \
  -H "Authorization: Bearer <adminAccessToken>" \
  -H "Content-Type: application/json" \
  -d '{"status":"clear"}'
```

---

## Dashboard

### `GET /api/dashboard/me`

Composes profile essentials, KYC status, criminal-record status, and
onboarding-fee payment status into one response — everything a dashboard
screen needs from a single request instead of the several separate ones each
module's own `/me` endpoint would otherwise require. Purely read-only: no new
persisted state, and every field is owned and validated by its source module
(see the Users/KYC/Criminal Record/Onboarding Fee sections above for what
each means).

**Headers:** `Authorization: Bearer <accessToken>` (or the `accessToken` cookie)

**200**
```json
{
  "success": true,
  "data": {
    "user": { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com" },
    "kyc": { "status": "not_started" },
    "criminalRecord": { "status": "pending" },
    "onboardingFee": { "status": "unpaid", "amountInRupees": 10 }
  },
  "requestId": "…"
}
```

**Errors:** `401` missing/invalid access token · `404` user no longer exists

```bash
curl http://localhost:3000/api/dashboard/me \
  -H "Authorization: Bearer <accessToken>"
```

---

## Request tracing

Send your own correlation id and it is echoed back and used in all logs:

```bash
curl http://localhost:3000/api/health -H "X-Request-Id: my-trace-123"
# Response header: X-Request-Id: my-trace-123
```
