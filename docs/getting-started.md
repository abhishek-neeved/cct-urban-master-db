# Getting Started

## Prerequisites

| Tool         | Version   | Notes                                             |
| ------------ | --------- | ------------------------------------------------- |
| **Node.js**  | 24.x      | Pinned in `.nvmrc`; `engine-strict` **fails the install** on a mismatch |
| **pnpm**     | 10.x      | Pinned via `packageManager`; run `corepack enable` |
| **Postgres** | >= 15     | Required for `pnpm dev` / `pnpm start` only — a Supabase project's connection string works too |
| **Git**      | any       | Required for Husky git hooks                      |

> Tests do **not** need a local Postgres — they use an in-memory Postgres
> (`@electric-sql/pglite`, WASM).

## 1. Install dependencies

First match the pinned Node version (a version manager reads `.nvmrc`):

```bash
nvm use          # or: fnm use / volta will auto-switch
```

Then install:

```bash
pnpm install
```

`engine-strict` is on, so `pnpm install` **errors out** if your Node/pnpm
version doesn't satisfy the `engines` field — every dev is forced onto the same
runtime. The install also runs the `prepare` script, which sets up Husky git
hooks (requires the folder to be a git repository — run `git init` first if it
isn't).

## 2. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env` as needed. Defaults are sensible for local development:

```dotenv
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/express_ts_layered
```

The full list of variables, defaults, and validation rules is documented in
[Configuration](./configuration.md) (source of truth:
[`src/shared/config/env.ts`](../src/shared/config/env.ts)).

## 3. Start Postgres and apply the schema

Point `DATABASE_URL` at any reachable Postgres. For a quick local instance with
Docker:

```bash
docker run -d --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
```

Or use a Supabase project — use its **direct** connection string (port 5432)
for the migration step below, and the **pooled** one (port 6543) in `DATABASE_URL`
for normal app traffic.

The `users`/`otps`/`refresh_tokens` schema is owned by `@nvcct/db-entities`, not
this repo. Apply its migrations once against your database:

```bash
for f in node_modules/@nvcct/db-entities/drizzle/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

(`drizzle/0002_pg_cron_expired_cleanup.sql` requires the `pg_cron` extension —
available on Supabase, not on a bare `postgres:17` container; skip it locally.)

## 4. Run the app

```bash
# Development — nodemon rebuilds (tsc) + restarts on change
pnpm dev

# Production — compile then run the JS output
pnpm build
pnpm start
```

On startup you should see:

```
✅ Connected to Postgres
🚀 Server listening on port 3000 (development)
```

## 5. Verify it works

```bash
curl http://localhost:3000/api/health
```

```json
{ "success": true, "data": { "status": "ok", "uptime": 1.23 }, "requestId": "…" }
```

Continue to the [API Reference](./api-reference.md) to exercise the auth
endpoints, or open the Swagger UI at `http://localhost:3000/api/docs`.

## Troubleshooting

| Symptom                                  | Cause / Fix                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `Invalid environment configuration`       | An env var failed validation — check the logged field errors            |
| Server hangs on start, no "Connected"     | Postgres not reachable at `DATABASE_URL`                                |
| `husky - .git can't be found`             | Run `git init` before `pnpm install` (Husky needs a git repo)           |
| Registration/login fails with a DB error  | Migrations from `@nvcct/db-entities` haven't been applied — see step 3  |
