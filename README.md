# CDMA Master DB

A production-ready **Express + TypeScript** REST API built on a **feature-modular,
layered architecture** (MVC + Service + Repository) with **dependency inversion**
at the data-access boundary.

> 📚 **Docs:** [Getting Started](./docs/getting-started.md) ·
> [API Reference](./docs/api-reference.md) · architecture & conventions in
> [`CLAUDE.md`](./CLAUDE.md).

## Features

- 🏗️ **Layered architecture** — Controller → Service → Repository, wired via dependency injection
- 🐘 **Supabase Postgres + Drizzle ORM** — data access behind a repository interface; schema owned by [`@nvcct/db-entities`](https://github.com/NVCCT/cdma-db-entities)
- ✉️ **Email/OTP account verification** — new accounts start unverified; a 6-digit OTP gates login until verified
- 🛡️ **Validation layer** — Zod schemas enforced by a reusable `validate` middleware before controllers run
- 📝 **Structured logging** with Winston (JSON in prod, pretty in dev)
- 🔗 **Request IDs** on every request, propagated through async code via `AsyncLocalStorage`
- 🧹 **ESLint + Prettier** for consistent, lint-clean code
- 🪝 **Husky + lint-staged** git hooks (pre-commit lint/format, pre-push type-check + tests)
- ✅ **Vitest** unit, integration, and **Supertest** e2e tests (integration/e2e run on an in-memory Postgres, `@electric-sql/pglite`)
- 🔒 Centralised error handling, Helmet + CORS

## Architecture

```
Request → Middleware (request-id, logger)
        → Router → validate() middleware   (validation layer — Zod)
        → Controller (HTTP mapping)
        → Service    (business logic)
        → Repository (Drizzle ORM / Supabase Postgres)
```

Each layer depends only on the abstraction of the layer below it, so any layer
can be tested in isolation and the data store can be swapped without touching
business logic. Request validation is a distinct layer: the `validate`
middleware parses `body`/`params`/`query` against Zod schemas and hands
already-validated data to the controller.

Feature-first: everything for a feature lives together under `modules/<feature>/`;
cross-cutting code lives under `shared/`.

```
src/
├── modules/                  feature slices (each self-wired via createXModule)
│   ├── auth/                 types, repository, service, validator, controller, routes
│   ├── health/               liveness/readiness controller
│   └── docs/                 OpenAPI JSON + Swagger UI routes
├── shared/                   cross-cutting code used by every module
│   ├── config/               env validation + Postgres connection
│   ├── middleware/           request-id, request-logger, validate, error-handler
│   ├── repositories/         BaseRepository<Attrs, Domain, CreateInput> (generic CRUD)
│   ├── utils/                logger, errors, request-context, password/token utils
│   ├── models/               API response shapes (success/failure envelopes)
│   ├── services/             cross-cutting services (e.g. email)
│   ├── docs/                 OpenAPI document assembly (swagger-jsdoc)
│   └── types/                Express type augmentation
├── routes/index.ts           thin mount table (composition root)
├── app.ts                    app assembly
└── server.ts                 entry point (connects DB, then listens)
```

Within a module, controllers/services/validators keep their strict layer
responsibilities — the folders just co-locate one feature's layers.

## Getting started

```bash
pnpm install          # also sets up Husky via the "prepare" script
cp .env.example .env  # set DATABASE_URL (defaults to postgresql://postgres:postgres@127.0.0.1:5432/express_ts_layered)
pnpm dev          # start with hot reload
```

Requires a running Postgres instance for `pnpm dev` / `pnpm start`, with
`@nvcct/db-entities`' migrations applied (see
[Getting Started](./docs/getting-started.md)). Tests do **not** need one —
integration and e2e tests spin up an in-memory Postgres via
`@electric-sql/pglite`.

## Scripts

| Script                  | Description                              |
| ----------------------- | ---------------------------------------- |
| `pnpm dev`           | Start dev server with hot reload         |
| `pnpm build`         | Compile TypeScript to `dist/`            |
| `pnpm start`             | Run the compiled server                  |
| `pnpm lint`          | Lint the codebase                        |
| `pnpm lint:fix`      | Lint and auto-fix                        |
| `pnpm format`        | Format with Prettier                     |
| `pnpm type-check`    | Type-check without emitting              |
| `pnpm test:unit`         | Run unit tests                           |
| `pnpm test:integration` | Run integration tests (in-memory Postgres) |
| `pnpm test:e2e`      | Run e2e tests (in-memory Postgres)          |
| `pnpm test:all`      | Run unit + integration + e2e tests       |
| `pnpm test:coverage` | Run all tests with coverage              |

## API

| Method | Path                                        | Description                                  |
| ------ | ------------------------------------------- | -------------------------------------------- |
| GET    | `/api/health`                               | Combined liveness + readiness probe (checks the DB connection) |
| POST   | `/api/auth/register`                        | Register an account (unverified; emails a verification OTP) |
| POST   | `/api/auth/verify-otp`                      | Verify an account with the emailed OTP       |
| POST   | `/api/auth/resend-otp`                      | Resend a verification OTP                    |
| POST   | `/api/auth/login`                           | Log in with email + password                 |
| POST   | `/api/auth/refresh`                         | Exchange a refresh token for a new pair      |
| POST   | `/api/auth/logout`                          | Revoke a refresh token                       |
| POST   | `/api/auth/forgot-password`                 | Request a password-reset link                |
| GET    | `/api/auth/verify-forgot-password-token`    | Check whether a reset token is valid         |
| POST   | `/api/auth/reset-password`                  | Set a new password using a reset token       |
| GET    | `/api/auth/me`                              | Get the authenticated user (Bearer token)    |

Credential endpoints (register/login/forgot/reset) are rate-limited. Interactive
docs (Swagger UI) are served at **`/api/docs`**, and the raw OpenAPI document at
**`/api/docs.json`**.

Every response includes the `requestId`, and the same id is returned in the
`X-Request-Id` response header for tracing.

See the [API Reference](./docs/api-reference.md) for full request/response shapes.

## Documentation

| Doc                                          | Covers                                           |
| -------------------------------------------- | ------------------------------------------------ |
| [Getting Started](./docs/getting-started.md) | Prerequisites, install, environment, running     |
| [Configuration](./docs/configuration.md)     | Environment variables, defaults, production rules |
| [API Reference](./docs/api-reference.md)     | Endpoints, request/response shapes, status codes |
| [Deployment](./docs/deployment.md)           | Docker build/run, health checks, prod checklist  |

Architecture and conventions live in [`CLAUDE.md`](./CLAUDE.md); the rest is
documented inline in the (small, commented) source.
