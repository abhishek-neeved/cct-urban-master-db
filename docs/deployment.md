# Deployment

The service ships as a container built from the multi-stage
[`Dockerfile`](../Dockerfile). This page covers building the image, running it,
and the production checklist.

## Build the image

```bash
docker build -t cdma-master-db .
```

The Dockerfile uses two stages on `node:24-alpine`:

1. **build** — installs all dependencies (`--frozen-lockfile --ignore-scripts`,
   which skips Husky/`only-allow`) and runs `pnpm build` to compile `src/` to
   `dist/`.
2. **runtime** — installs **production dependencies only**, copies `dist/` from
   the build stage, drops to the non-root `node` user, and starts
   `node dist/server.js`.

pnpm is enabled via `corepack` (pinned by the `packageManager` field), so the
image uses the same pnpm version as local development.

## Run the container

Provide configuration via environment variables (see
[Configuration](./configuration.md)). In production a strong
`JWT_ACCESS_SECRET` and a non-empty `CORS_ORIGINS` are **mandatory** — the app
refuses to boot otherwise.

```bash
docker run -d --name cdma-master-db \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e MONGO_URI="mongodb://<host>:27017/cdma_master_db" \
  -e JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
  -e CORS_ORIGINS="https://app.example.com" \
  -e APP_URL="https://api.example.com" \
  cdma-master-db
```

> Prefer a secrets manager or orchestrator secret over `-e` on the command line
> for `JWT_ACCESS_SECRET` and `MONGO_URI`.

## Health check

The image declares a `HEALTHCHECK` that polls the combined health probe
(`GET /api/health`), so the container is only reported healthy once MongoDB is
reachable (`ok: 1`). Point both your orchestrator's liveness and readiness
probes at `GET /api/health` (see the [API Reference](./api-reference.md#health)).

## Graceful shutdown

[`server.ts`](../src/server.ts) traps `SIGTERM`/`SIGINT`, stops accepting new
connections, closes the MongoDB connection, then exits `0`. Orchestrators that
send `SIGTERM` (Docker, Kubernetes) get a clean drain. Unhandled promise
rejections are logged rather than crashing the process.

## Production checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_ACCESS_SECRET` set to a strong secret (≥ 32 chars, not the dev default)
- [ ] `CORS_ORIGINS` lists your real front-end origin(s)
- [ ] `MONGO_URI` points at your production database
- [ ] `APP_URL` set to the public API URL (used in reset-password email links)
- [ ] A real email transport wired in place of the dev `LoggerEmailService`
      (see [`src/shared/services/email.service.ts`](../src/shared/services/email.service.ts))
- [ ] Reverse proxy / load balancer probes wired to `/api/health`

## Building without Docker

```bash
pnpm install --frozen-lockfile
pnpm build      # emits runnable native-ESM JS to dist/
pnpm start      # node dist/server.js
```

`tsc-alias` rewrites path aliases to relative paths and appends `.js`, so `dist/`
runs as native ESM on Node 24 with no extra tooling.
