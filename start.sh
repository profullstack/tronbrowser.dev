#!/bin/sh
# Run the Hono API on a fixed internal port, then Caddy (which serves static and
# reverse-proxies /api to the API) on Railway's $PORT in the foreground.
set -e
# Apply any pending DB migrations on boot (idempotent, forward-only). Non-fatal:
# a transient DB hiccup shouldn't block the whole service from starting.
MIGRATIONS_DIR=/api/migrations node /api/db-migrate.mjs || echo "[migrate] FAILED — continuing"
PORT=8090 node /api/dist/index.js &
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
