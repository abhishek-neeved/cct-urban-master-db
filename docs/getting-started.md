# Getting Started

## Prerequisites

| Tool        | Version   | Notes                                             |
| ----------- | --------- | ------------------------------------------------- |
| **Node.js** | 24.x      | Pinned in `.nvmrc`; `engine-strict` **fails the install** on a mismatch |
| **pnpm**    | 10.x      | Pinned via `packageManager`; run `corepack enable` |
| **MongoDB** | >= 6      | Required for `pnpm dev` / `pnpm start` only     |
| **Git**     | any       | Required for Husky git hooks                      |

> Tests do **not** need a local MongoDB — they use an in-memory server
> (`mongodb-memory-server`).

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
MONGO_URI=mongodb://127.0.0.1:27017/express_ts_layered
```

The full list of variables and their validation rules lives in
[`src/shared/config/env.ts`](../src/shared/config/env.ts).

## 3. Start MongoDB

Point `MONGO_URI` at any reachable MongoDB. For a quick local instance with
Docker:

```bash
docker run -d --name mongo -p 27017:27017 mongo:7
```

Or use a hosted cluster (e.g. MongoDB Atlas) and set its connection string in
`MONGO_URI`.

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
✅ Connected to MongoDB
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

| Symptom                                  | Cause / Fix                                                        |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `Invalid environment configuration`      | An env var failed validation — check the logged field errors       |
| Server hangs on start, no "Connected"    | MongoDB not reachable at `MONGO_URI`                               |
| `husky - .git can't be found`            | Run `git init` before `pnpm install` (Husky needs a git repo)       |
| First test run is slow                   | `mongodb-memory-server` downloads a MongoDB binary once, then caches |
