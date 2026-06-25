#!/bin/sh
# Run the Hono API on a fixed internal port, then Caddy (which serves static and
# reverse-proxies /api to the API) on Railway's $PORT in the foreground.
set -e
PORT=8090 node /api/dist/index.js &
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
