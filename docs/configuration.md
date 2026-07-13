# Configuration

All runtime configuration comes from **environment variables**, validated once
at startup by [`src/shared/config/env.ts`](../src/shared/config/env.ts) using
Zod. If any variable fails validation the process **refuses to boot** and logs
the offending fields (`Invalid environment configuration`). Defaults and bounds
live in [`src/shared/config/constants.ts`](../src/shared/config/constants.ts).

Copy [`.env.example`](../.env.example) to `.env` to get started:

```bash
cp .env.example .env
```

`dotenv` loads `.env` automatically; in real deployments prefer setting the
variables in the environment directly.

## Variables

| Variable                     | Type / allowed              | Default                                        | Notes                                                                    |
| ---------------------------- | --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                   | `development` \| `test` \| `production` | `development`                      | Selects behaviour (logging format, dev-only responses, rate-limit skip). |
| `PORT`                       | positive integer            | `3000`                                         | Port the HTTP server listens on.                                         |
| `LOG_LEVEL`                  | `error`\|`warn`\|`info`\|`http`\|`debug` | `info`                            | Winston log level.                                                       |
| `MONGO_URI`                  | non-empty string            | `mongodb://127.0.0.1:27017/cdma_master_db`     | MongoDB connection string. Required at runtime (`dev`/`start`).          |
| `APP_URL`                    | URL                         | `http://localhost:3000`                        | Base URL used to build links in emails (e.g. the password-reset link) and as the OpenAPI server URL. |
| `JWT_ACCESS_SECRET`          | non-empty string            | `dev-access-secret-change-me` (dev only)       | Signs access-token JWTs. **In production must be set and ≥ 32 chars** — the dev default is rejected. |
| `JWT_ACCESS_EXPIRES_IN`      | string (e.g. `15m`, `1h`)   | `15m`                                          | Access-token lifetime (`jsonwebtoken` `expiresIn` format).               |
| `REFRESH_TOKEN_TTL_DAYS`     | positive integer            | `7`                                            | Refresh-token lifetime in days.                                          |
| `BCRYPT_SALT_ROUNDS`         | integer 10–15               | `12`                                           | bcrypt cost factor for password hashing.                                 |
| `PASSWORD_RESET_TTL_MINUTES` | positive integer            | `60`                                           | How long a password-reset token stays valid.                            |
| `CORS_ORIGINS`               | comma-separated origins     | _(unset)_                                      | Allowlist of origins. Empty in dev reflects any origin; **required (non-empty) in production**. |

## Production-only rules

`env.ts` enforces two extra invariants when `NODE_ENV=production` — both **fail
the boot** if violated:

1. **`JWT_ACCESS_SECRET`** must not be the shared dev default and must be at
   least 32 characters. Never ship the dev secret.
2. **`CORS_ORIGINS`** must list at least one origin — production never falls
   back to open, reflect-any CORS.

## Environment-dependent behaviour

- **Logging** — JSON logs in production, pretty/colourised logs otherwise.
- **`forgot-password`** — outside production the raw reset token is returned in
  the response (`resetToken`) so the flow can be tested without a mail server;
  in production it is only emailed.
- **Rate limiting** — the credential-endpoint limiter is skipped entirely when
  `NODE_ENV=test` so the test suite isn't throttled.

See [Getting Started](./getting-started.md) for install/run steps and
[Deployment](./deployment.md) for the production checklist.
