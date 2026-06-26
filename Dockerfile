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
# openssh-client: the store provisions BBS publisher accounts and generates
# ed25519 keypairs via `ssh`/`ssh-keygen` (services/api/src/store/fileshost.ts).
RUN apk add --no-cache nodejs openssh-client
COPY Caddyfile /etc/caddy/Caddyfile
COPY apps/web/public/ /srv/
# Extension store (tronbrowser.dev/store) — static frontend; dynamic bits hit
# /api/store on the bundled API.
COPY apps/extensions/public/ /srv/store/
# Branding lives at the repo root (single source of truth). apps/web/public has
# symlinks to them for local dev, but Docker COPY won't follow symlinks pointing
# outside the copied dir — so copy the real files in (these override the links).
COPY logo.svg favicon.svg hero.svg banner.png /srv/
COPY --from=api /api/dist /api/dist
COPY --from=api /api/node_modules /api/node_modules
COPY --from=api /api/package.json /api/package.json
# DB migrations run on boot (start.sh) so schema never drifts from the deploy.
COPY scripts/db-migrate.mjs /api/db-migrate.mjs
COPY packages/storage/migrations /api/migrations
COPY start.sh /start.sh
RUN chmod +x /start.sh
CMD ["/start.sh"]
