---
description: Run the fast quality gate — format check, lint, type-check, and unit tests
allowed-tools: Bash(pnpm *), Bash(pnpm run *)
---

Run the project's quality gate and report results concisely. Run these in order
and show a short pass/fail summary for each:

1. `pnpm format:check` — Prettier formatting
2. `pnpm lint` — ESLint
3. `pnpm type-check` — TypeScript
4. `pnpm knip` — unused files / exports / dependencies
5. `pnpm test:unit` — unit tests

If any step fails, show the relevant output and stop. If a formatting or lint
issue is auto-fixable, offer to run `pnpm format` / `pnpm lint:fix`.
Do NOT run integration/e2e here (that's `/verify-all`).
