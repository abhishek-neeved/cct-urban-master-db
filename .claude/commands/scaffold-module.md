---
description: Scaffold a complete new resource module (model, repo, service, validator, controller, routes, tests) following the feature-modular layered architecture
argument-hint: <ResourceName> [field:type ...]  e.g. Product name:string price:number
---

Scaffold a new CRUD resource module named **$1** following this project's
feature-first layered architecture. Every file for the resource lives together in
`src/modules/<resource>/`. Use the existing **auth** module
(`src/modules/auth/`) as the reference for the full vertical slice — structure,
naming, and conventions.

Fields (optional, after the name): $ARGUMENTS

Create the full vertical slice under `src/modules/<resource>/`, wired end to end.
Within the module, import siblings with **relative paths** (`./<resource>.service`);
use aliases (`@shared/*`, `@utils/*`, `@middleware/*`, `@models/*`) only for
shared, cross-cutting code.

1. **Table + domain types** — add `<resource>Table` to
   `@nvcct/db-entities`' `src/schema/<resource>.ts` (the shared package, a sibling
   repo — see its `add-table` skill), following its `pgTable`/`<Resource>Row`/`New<Resource>`
   convention. In this repo, `src/modules/<resource>/<resource>.model.ts` holds only
   the plain domain types (`<Resource>`, `Create<Resource>Input`) and the
   `to<Resource>()` mapper (row → domain type) — no schema definition lives here.
2. **Repository** — `src/modules/<resource>/<resource>.repository.ts`
   - An `I<Resource>Repository` interface + a class extending
     `BaseRepository<Table, Row, Domain, CreateInput>` (from `@shared/repositories/base.repository`),
     whose constructor calls `super(db, <resource>Table, <resource>Table.id, to<Resource>, { duplicateKeyMessage })`
     (`db` from `@shared/config/database`, the table from `@nvcct/db-entities`)
   - Inherit the generic CRUD (`findById`, `findOne`, `find`, `create`,
     `updateById`, `deleteById`, `count`, `existsBy`) — `findOne`/`find`/`count`/`existsBy`
     take a Drizzle `SQL` condition (`eq`/`and`/`gt` from `drizzle-orm`), not a plain
     filter object. Add only resource-specific queries. The base already guards
     uuid ids and maps Postgres unique-violation errors (SQLSTATE `23505`) to
     `ConflictError`.
3. **Service** — `src/modules/<resource>/<resource>.service.ts`
   - Constructor-injected repository, business rules, typed errors from `@utils/errors`
4. **Validator** — `src/modules/<resource>/<resource>.validator.ts`
   - Zod `create` / `update` / `idParam` schemas (idParam validates a uuid)
5. **Controller** — `src/modules/<resource>/<resource>.controller.ts`
   - Thin handlers reading already-validated `req.body`/`req.params`
   - Wrap each handler in `asyncHandler` (from `@middleware/async-handler`) — no try/catch
   - Use `StatusCodes` from `http-status-codes` and the `success()` envelope
6. **Routes** — `src/modules/<resource>/<resource>.routes.ts`
   - A `create<Resource>Module()` factory that wires repository → service →
     controller and returns the router (mirror `createAuthModule`)
   - CRUD routes each guarded by the `validate({...})` middleware
7. **Wire it up** — in `src/routes/index.ts`, import `create<Resource>Module` from
   `@modules/<resource>/<resource>.routes` and add one `router.use('/<resources>', create<Resource>Module())` line
8. **Tests**
   - `tests/unit/services/<resource>.service.spec.ts` (mocked repository)
   - `tests/integration/repositories/<resource>.repository.spec.ts` (in-memory Postgres via `tests/helpers/db.ts`)
   - `tests/e2e/<resource>.e2e.spec.ts` (full CRUD + 422/409/404 cases)

Use relative imports within the module and the shared path aliases
(`@shared/*`, `@utils/*`, `@middleware/*`, `@models/*`) for cross-cutting code,
matching the existing code style precisely. After scaffolding, run `pnpm type-check`,
`pnpm lint`, `pnpm knip`, and `pnpm test:all`, and fix anything that fails. Finally,
update `docs/api-reference.md` with the new endpoints.
