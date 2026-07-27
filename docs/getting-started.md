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

## 3. Start Postgres

Point `DATABASE_URL` at any reachable Postgres. For a quick local instance with
Docker:

```bash
docker run -d --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
```

Or use a Supabase project (its pooled, port-6543 connection string works fine
for `DATABASE_URL` — see [Migrations](#migrations) below for why).

## 4. Run the app

```bash
# Development — nodemon rebuilds (tsc) + restarts on change
pnpm dev

# Production — compile then run the JS output
pnpm build
pnpm start
```

The `users`/`otps`/`refresh_tokens`/`blockchains` schema is owned by
`@nvcct/db-entities`, not this repo — its migrations are synced into this
repo's own [`drizzle/`](../drizzle) folder (`pnpm db:sync-migrations`) and
**applied automatically on every boot** (see [Migrations](#migrations)), so
there's no separate manual step. On startup you should see:

```
Acquiring migration lock…
✅ Already up to date
✅ Connected to Postgres
🚀 Server listening on port 3000 (development)
```

(`drizzle/0002_pg_cron_expired_cleanup.sql` requires the `pg_cron` extension —
available on Supabase, not on a bare `postgres:17` container. Boot will fail
at that migration against a bare container; use a Supabase-backed
`DATABASE_URL`, including locally.)

## 5. Verify it works

```bash
curl http://localhost:3000/api/health
```

```json
{ "success": true, "data": { "ok": 1, "db": "up", "uptime": 1.23 }, "requestId": "…" }
```

Continue to the [API Reference](./api-reference.md) to exercise the auth
endpoints, or open the Swagger UI at `http://localhost:3000/api/docs`.

## Migrations

Schema migrations live in this repo's own [`drizzle/`](../drizzle) folder —
copied from `@nvcct/db-entities` (which owns the schema, but ships no
connection/migration runner of its own), not read from `node_modules` at
runtime.

| Script                       | What it does                                                       |
| ----------------------------- | ------------------------------------------------------------------- |
| `pnpm db:sync-migrations`     | Copies `@nvcct/db-entities`'s migration files into this repo's `drizzle/`. Run after bumping the dependency; review the diff and commit it. |
| `pnpm db:migrate`             | Applies every not-yet-applied migration from `drizzle/`, tracked in a `drizzle.__drizzle_migrations` table. Runs automatically on every server boot ([`server.ts`](../src/server.ts)) — this is a manual/CI equivalent, e.g. to migrate without starting the server. |
| `pnpm db:baseline-migrations` | **One-time only**, for a database whose schema was already applied by some other means before this tooling existed — marks every current migration as already-applied *without* running its SQL. Refuses to run if the tracking table already has rows. |

Migrations apply inside a single transaction holding a
`pg_advisory_xact_lock` — safe under Supabase's pooled (PgBouncer
transaction-mode) connection string, unlike a session-level advisory lock —
so a multi-instance deployment never runs migrations concurrently: every
instance but one simply blocks until the first commits, then finds
everything already applied.

## Troubleshooting

| Symptom                                  | Cause / Fix                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `Invalid environment configuration`       | An env var failed validation — check the logged field errors            |
| Server hangs on start, no "Connected"     | Postgres not reachable at `DATABASE_URL`                                |
| `husky - .git can't be found`             | Run `git init` before `pnpm install` (Husky needs a git repo)           |
| Server fails to boot with a `pg_cron` error | You're pointed at a bare Postgres, not Supabase — see step 4 above    |
| `Can't find meta/_journal.json file`      | Run `pnpm db:sync-migrations` first — `drizzle/` doesn't exist yet       |
| Registration/login fails with a DB error  | Migrations haven't been applied — see [Migrations](#migrations); they should auto-apply on boot |
