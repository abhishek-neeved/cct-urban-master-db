# ---- Build stage ----
FROM node:24-alpine AS build
WORKDIR /app

# Enable the pnpm version pinned in package.json's "packageManager" field.
RUN corepack enable

# Install all deps (incl. dev) without running lifecycle scripts (skips husky/only-allow).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

# ---- Runtime stage ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

# Production dependencies only.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && pnpm store prune

COPY --from=build /app/dist ./dist

EXPOSE 3000
USER node

# Container health = readiness probe (DB reachable). Node 24 has global fetch.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
