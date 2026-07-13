# CLAUDE.md

Project context for Claude Code. Read this before making changes.

## What this is

An **Express + TypeScript** REST API using an **MVC + Service + Repository**
layered architecture, with **MongoDB/Mongoose**, JWT auth (access + rotating
refresh tokens), Zod validation, Winston logging, and Vitest tests. The project
is **native ESM** (`"type": "module"`, `moduleResolution: bundler`). Full docs live
in [`docs/`](./docs/README.md).

The current API surface is the **auth** module (`/api/auth/*`): register, login,
refresh, logout, forgot-password, verify-forgot-password-token, reset-password.
See [`docs/api-reference.md`](./docs/api-reference.md).

## Architecture (respect the layering)

```
Middleware → Router → validate() → Controller → Service → Repository → MongoDB
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
- **Service** — business rules and invariants. Must NOT touch `req`/`res` or Mongoose.
- **Repository** — the ONLY layer that imports Mongoose. Extend
  `BaseRepository<Attrs, Domain, CreateInput>` (`@shared/repositories/base.repository`)
  to inherit generic CRUD (`findById`, `findOne`, `find`, `create`, `updateById`,
  `deleteById`, `count`, `existsBy`) — it guards ObjectIds and maps duplicate-key
  errors to `ConflictError`. Add only entity-specific queries. Map documents to the
  domain type via `to<Entity>()`; Mongo details (`_id`, documents) never leak upward.

## Folder layout (feature-first)

Everything for a feature lives together under `src/modules/<feature>/` (model,
repository, service, validator, controller, routes). Cross-cutting code lives
under `src/shared/` (`config/`, `middleware/`, `utils/`, `models/`, `services/`,
`docs/`, `types/`). `src/routes/index.ts` mounts the module routers.

```
src/
  modules/<feature>/   # e.g. auth/ — the reference slice; health/, docs/
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
  `validate({...})`. Validate ObjectId params, not just bodies.
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
the data layer or endpoints, run `pnpm test:all`. Tests use an in-memory MongoDB
— no local database required. CI (GitHub Actions) runs the same checks plus a
security workflow (CodeQL, dependency review, `pnpm audit`).

## Notes / gotchas

- Tests need no local MongoDB; `mongodb-memory-server` downloads a binary on the
  first integration/e2e run, so that run is slower.
- `pnpm dev` / `pnpm start` DO need a real MongoDB at `MONGO_URI`.
- Husky hooks require a git repo (`git init`). pre-commit runs lint-staged;
  pre-push runs type-check + unit tests.
- A `PostToolUse` hook auto-formats edited `.ts` files with Prettier
  (`.claude/hooks/format.mjs`), so don't worry about hand-formatting.
