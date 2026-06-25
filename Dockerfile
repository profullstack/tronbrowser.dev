# Single container for tronbrowser.dev: Caddy serves the static site and
# reverse-proxies /api to the bundled Hono API (one service, one domain).
# Built from the monorepo root context.

# --- build the API ---
FROM node:24-slim AS api
WORKDIR /api
COPY services/api/package.json ./
RUN npm install --no-audit --no-fund
COPY services/api/src ./src
RUN printf '%s' '{"compilerOptions":{"target":"ES2023","module":"NodeNext","moduleResolution":"NodeNext","outDir":"dist","rootDir":"src","strict":true,"skipLibCheck":true,"esModuleInterop":true},"include":["src"]}' > tsconfig.build.json \
  && npx tsc -p tsconfig.build.json \
  && npm prune --omit=dev

# --- final: caddy + node ---
FROM caddy:2-alpine
RUN apk add --no-cache nodejs
COPY Caddyfile /etc/caddy/Caddyfile
COPY apps/web/public/ /srv/
# Branding lives at the repo root (single source of truth). apps/web/public has
# symlinks to them for local dev, but Docker COPY won't follow symlinks pointing
# outside the copied dir — so copy the real files in (these override the links).
COPY logo.svg favicon.svg banner.png /srv/
COPY --from=api /api/dist /api/dist
COPY --from=api /api/node_modules /api/node_modules
COPY --from=api /api/package.json /api/package.json
COPY start.sh /start.sh
RUN chmod +x /start.sh
CMD ["/start.sh"]
