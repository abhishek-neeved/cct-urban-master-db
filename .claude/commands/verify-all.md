---
description: Full verification — type-check, lint, and the entire test suite (unit + integration + e2e)
allowed-tools: Bash(pnpm *), Bash(pnpm run *)
---

Run the complete verification pipeline and report a clear pass/fail summary:

1. `pnpm type-check`
2. `pnpm lint`
3. `pnpm knip` (unused files / exports / dependencies)
4. `pnpm test:all` (unit + integration + e2e on an in-memory Postgres via `@electric-sql/pglite`)

If anything fails, surface the failing test names and the relevant output, and
propose a fix. Otherwise confirm everything is green.
