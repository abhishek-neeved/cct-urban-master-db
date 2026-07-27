# CLAUDE.md

Project context for Claude Code. Read this before making changes.

## What this is

An **Express + TypeScript** REST API using an **MVC + Service + Repository**
layered architecture, with **Supabase Postgres via Drizzle ORM** (schema owned
by the shared [`@nvcct/db-entities`](https://github.com/NVCCT/cdma-db-entities)
package), JWT auth (access + rotating refresh tokens), Zod validation, Winston
logging, and Vitest tests. The project is **native ESM** (`"type": "module"`,
`moduleResolution: bundler`). Full docs live in [`docs/`](./docs/README.md).

The current API surface is the **auth** module (`/api/auth/*`): register,
verify-otp, resend-otp, login, refresh, logout, forgot-password,
verify-forgot-password-token, reset-password; and the read-only **blockchain**
module (`GET /api/blockchains`: search + pagination). See
[`docs/api-reference.md`](./docs/api-reference.md).

## Architecture (respect the layering)

```
Middleware → Router → validate() → Controller → Service → Repository → Postgres (Supabase)
```

Dependencies point downward and are wired **per feature module**: each
`createXModule()` (e.g. [`src/modules/auth/auth.routes.ts`](./src/modules/auth/auth.routes.ts))
constructs its own repositories → service → controller and returns a router.
[`src/routes/index.ts`](./src/routes/index.ts) is just a thin mount table — add a
feature by writing its module factory and adding one `router.use(...)` line.
Keep each layer's responsibility strict:

- **Controller** — HTTP ↔ service mapping only. No validation, no business logic.
  Wrap every handler in `asyncHandler` (from `@middleware/async-handler`) instead
  of writing try/catch — it forwards thrown errors to the central error handler.
- **Validation** — Zod schemas in each module's `*.validator.ts`, enforced by the
  `validate` middleware in routes. Controllers receive already-validated data.
- **Service** — business rules and invariants. Must NOT touch `req`/`res` or drizzle-orm.
- **Repository** — the ONLY layer that imports `drizzle-orm`/`@nvcct/db-entities`.
  Extend `BaseRepository<Table, Row, Domain, CreateInput>`
  (`@shared/repositories/base.repository`) to inherit generic CRUD (`findById`,
  `findOne`, `find`, `findPaginated`, `create`, `updateById`, `deleteById`,
  `count`, `existsBy`) — it guards uuid ids and maps Postgres unique-violation
  errors (SQLSTATE `23505`) to `ConflictError`. `findOne`/`find`/`findPaginated`/
  `count`/`existsBy` take a Drizzle `SQL` condition (build with `eq`/`and`/`gt`
  from `drizzle-orm`), not a plain filter object. `findPaginated(where, page,
  limit)` runs the page and count queries in parallel against the *same*
  `where` (so `total` reflects the filtered set) and wraps the result with
  `buildPaginatedResult` from `@nvcct/db-entities` — reuse it for any list
  endpoint that needs search + pagination rather than hand-rolling one. Add
  only entity-specific queries beyond that. Map rows to the domain type via
  `to<Entity>()`; Postgres details (raw rows) never leak upward. Not every
  repository extends `BaseRepository` — `RefreshTokenRepository` queries its
  table directly, matching its pre-migration shape.

## Folder layout (feature-first)

Everything for a feature lives together under `src/modules/<feature>/` (types,
repository, service, validator, controller, routes). Cross-cutting code lives
under `src/shared/` (`config/`, `middleware/`, `utils/`, `models/`, `services/`,
`docs/`, `types/`). `src/routes/index.ts` mounts the module routers.

```
src/
  modules/<feature>/   # e.g. auth/ — the reference slice; blockchain/, health/, docs/
  shared/              # config, middleware, utils, models, docs, types
  routes/index.ts      # thin mount table
  app.ts  server.ts
```

Within a module, import siblings with **relative paths** (`./auth.service`); use
aliases only for shared code. When adding a resource, mirror the **auth** module —
the `/scaffold-module` command does this automatically.

## Conventions

- **Path aliases** — `@modules/*` (feature code) and `@shared/*` (cross-cutting),
  plus the shortcuts `@config/*`, `@middleware/*`, `@utils/*`, `@models/*` (all
  under `shared/`) and `@routes/*`. Defined in `tsconfig.json` and mirrored in
  `vitest.config.ts` (`resolve.alias`). Use relative imports within a module; use
  aliases across modules and for shared code — don't use long relative paths.
- **ESM imports** — native ESM with `moduleResolution: bundler`, so **imports in
  `src/` are extensionless** (`import './auth.service'`, `@utils/logger`) — no
  `.js` needed. At build time `tsc-alias` (`resolveFullPaths`) rewrites aliases to
  relative paths **and appends `.js`**, so the emitted `dist/` is runnable native
  ESM. Dev (`nodemon` → `tsc` + `tsc-alias`, which also type-checks each restart)
  and tests (Vitest/esbuild) resolve extensionless directly. No
  `require`/`__dirname`/`module.exports` — use `import` and
  `import.meta.dirname`/`import.meta.url`.
- **Errors** — throw typed errors from `@utils/errors` (`NotFoundError`,
  `ConflictError`, etc.); the central error handler maps them to status codes.
  Don't build error responses in controllers.
- **Logging** — use `logger` from `@utils/logger`, never `console.log`. Request
  ids are attached automatically via `AsyncLocalStorage`.
- **Responses** — use the `success()` / `failure()` helpers from
  `@models/api-response`; always include `req.id`.
- **Async controllers** — wrap handlers in `asyncHandler`; never write try/catch
  in a controller just to call `next(err)`.
- **Validation** — every route with a body/query/param goes through
  `validate({...})`. Validate uuid params, not just bodies.
- **Secrets & passwords** — never log or return the password hash; hash with
  bcrypt (`@utils/password.util`). Store only the SHA-256 hash of refresh and
  reset tokens, never the raw value.
- **Strict TypeScript** — no `any` (ESLint warns). Keep it type-clean.

## Commands

This project uses **pnpm** (pinned via `packageManager`); a `preinstall` guard
rejects npm/yarn. Use `pnpm <script>`. **Node is pinned to 24.x** (`.nvmrc`);
`engine-strict` makes `pnpm install` **fail** on a mismatched Node/pnpm version,
so every environment stays on the same runtime — run `nvm use` first.

| Task              | Command                     |
| ----------------- | --------------------------- |
| Dev server        | `pnpm dev`                  |
| Type-check        | `pnpm type-check`           |
| Lint / fix        | `pnpm lint` / `lint:fix`    |
| Format            | `pnpm format`               |
| Unit tests        | `pnpm test:unit`            |
| All tests         | `pnpm test:all`             |
| Unused code/deps  | `pnpm knip`                 |
| Build             | `pnpm build`                |

Custom slash commands: `/check` (fast quality gate), `/verify-all` (full test
suite), `/scaffold-module <Name>` (new resource module).

## Definition of done

Before considering a change complete, run `/check` (or manually:
`pnpm type-check`, `pnpm lint`, `pnpm knip`, `pnpm test:unit`). For changes touching
the data layer or endpoints, run `pnpm test:all`. Tests use an in-memory Postgres
(`@electric-sql/pglite`) — no local database required. CI (GitHub Actions) runs
the same checks plus a security workflow (CodeQL, dependency review, `pnpm audit`).

## Notes / gotchas

- Tests need no local Postgres; `tests/helpers/db.ts` spins up an in-memory
  `@electric-sql/pglite` instance per test file and pushes `@nvcct/db-entities`'
  schema plus its hand-authored trigger migration into it (not the Supabase-only
  `pg_cron` one).
- `pnpm dev` / `pnpm start` DO need a real Postgres at `DATABASE_URL`, with
  `@nvcct/db-entities`' migrations already applied (see
  [docs/getting-started.md](./docs/getting-started.md)).
- Husky hooks require a git repo (`git init`). pre-commit runs lint-staged;
  pre-push runs type-check + unit tests.
- A `PostToolUse` hook auto-formats edited `.ts` files with Prettier
  (`.claude/hooks/format.mjs`), so don't worry about hand-formatting.
- `@nvcct/db-entities` is a private GitHub Packages dependency — installing it
  requires a PAT with `read:packages` in `~/.npmrc` locally, and the
  `PACKAGES_READ_TOKEN` repo secret in CI (see `.npmrc` and
  `.github/actions/setup`). Never pin it back to a local `file:../db-entities`
  path on a shared branch — CI only checks out this repo, not a sibling one.
