# TronBrowser auth/sync API. Built from the monorepo root context.
FROM node:24-slim
RUN corepack enable
WORKDIR /app

# Workspace manifests first for cached installs.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY services/api/package.json services/api/package.json
RUN pnpm install --frozen-lockfile --filter @tronbrowser/api...

COPY . .
RUN pnpm --filter @tronbrowser/api build

ENV PORT=8080
EXPOSE 8080
# Apply migrations, then start the server.
CMD ["sh", "-c", "node scripts/db-migrate.mjs && node services/api/dist/index.js"]
