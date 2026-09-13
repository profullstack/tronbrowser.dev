# Single container for tronbrowser.dev: Caddy serves the static site and
# reverse-proxies /api and /mcp to the bundled Hono API (one service, one
# domain). Built from the monorepo root context.
#
# The API now carries the OpenMCP relay at /mcp/tron, so the image also holds
# its two engines: ungoogled-chromium (the portable Linux build, headless) and
# Obscura. Both are pinned below; bump the ARGs to move them.

ARG UNGOOGLED_CHROMIUM_VERSION=152.0.7977.82-1
ARG OBSCURA_VERSION=0.2.2

# --- build the API (a pnpm workspace member: it imports @tronbrowser/sdk) ---
FROM node:24-bookworm-slim AS api
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/browser-core/package.json packages/browser-core/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/sdk/package.json packages/sdk/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --filter @tronbrowser/api...
COPY packages/browser-core packages/browser-core
COPY packages/agent-runtime packages/agent-runtime
COPY packages/sdk packages/sdk
COPY services/api services/api
RUN pnpm --filter @tronbrowser/browser-core --filter @tronbrowser/agent-runtime --filter @tronbrowser/sdk --filter @tronbrowser/api build \
  && pnpm --filter @tronbrowser/api deploy --prod /out

# --- engines: fetched once at build time, not at boot ---
FROM debian:bookworm-slim AS engines
ARG UNGOOGLED_CHROMIUM_VERSION
ARG OBSCURA_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils && rm -rf /var/lib/apt/lists/*
RUN set -eu; arch="$(uname -m)"; case "$arch" in x86_64) uc=x86_64; ob=x86_64 ;; aarch64) uc=arm64; ob=aarch64 ;; *) echo "unsupported arch $arch" >&2; exit 1 ;; esac; \
  mkdir -p /opt/ungoogled-chromium /opt/obscura; \
  curl -fsSL "https://github.com/ungoogled-software/ungoogled-chromium-portablelinux/releases/download/${UNGOOGLED_CHROMIUM_VERSION}/ungoogled-chromium-${UNGOOGLED_CHROMIUM_VERSION}-${uc}_linux.tar.xz" \
    | tar -xJ --strip-components=1 -C /opt/ungoogled-chromium; \
  test -x /opt/ungoogled-chromium/chrome; \
  curl -fsSL "https://github.com/h4ckf0r0day/obscura/releases/download/v${OBSCURA_VERSION}/obscura-${ob}-linux-stealth.tar.gz" \
    | tar -xz -C /opt/obscura; \
  test -x /opt/obscura/obscura

# --- final: caddy + node + tor + the engines ---
# Debian rather than Alpine: the portable ungoogled-chromium and Obscura are
# glibc binaries. Caddy is a static binary, copied from its own image.
FROM node:24-bookworm-slim
COPY --from=caddy:2 /usr/bin/caddy /usr/bin/caddy
# openssh-client: the store provisions BBS publisher accounts and generates
# ed25519 keypairs via `ssh`/`ssh-keygen` (services/api/src/store/fileshost.ts).
# tor: runs a Tor v3 hidden service in this same container so tronbrowser.dev is
# reachable over a stable .onion (start.sh writes torrc and boots it). The onion
# key persists on a Railway volume mounted at /var/lib/tor/hidden_service.
# The lib* rows are what headless Chromium links against; fonts so text renders.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssh-client tor \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
    libcairo2 libatspi2.0-0 libxshmfence1 libx11-6 libx11-xcb1 libxcb1 libxext6 libglib2.0-0 \
    libdbus-1-3 libexpat1 fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
COPY --from=engines /opt/ungoogled-chromium /opt/ungoogled-chromium
COPY --from=engines /opt/obscura /opt/obscura
ENV TRON_MCP_CHROMIUM_BIN=/opt/ungoogled-chromium/chrome \
    OBSCURA_BIN=/opt/obscura/obscura
COPY Caddyfile /etc/caddy/Caddyfile
COPY apps/web/public/ /srv/
# Extension store (tronbrowser.dev/store) — static frontend; dynamic bits hit
# /api/store on the bundled API.
COPY apps/extensions/public/ /srv/store/
# Branding lives at the repo root (single source of truth). apps/web/public has
# symlinks to them for local dev, but Docker COPY won't follow symlinks pointing
# outside the copied dir — so copy the real files in (these override the links).
COPY logo.svg favicon.svg hero.svg banner.png /srv/
COPY --from=api /out/dist /api/dist
COPY --from=api /out/node_modules /api/node_modules
COPY --from=api /out/package.json /api/package.json
# DB migrations run on boot (start.sh) so schema never drifts from the deploy.
COPY scripts/db-migrate.mjs /api/db-migrate.mjs
COPY packages/storage/migrations /api/migrations
COPY start.sh /start.sh
RUN chmod +x /start.sh
CMD ["/start.sh"]
