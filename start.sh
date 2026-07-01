#!/bin/sh
# Run the Hono API on a fixed internal port, then Caddy (which serves static and
# reverse-proxies /api to the API) on Railway's $PORT in the foreground.
set -e
# Apply any pending DB migrations on boot (idempotent, forward-only). Non-fatal:
# a transient DB hiccup shouldn't block the whole service from starting.
MIGRATIONS_DIR=/api/migrations node /api/db-migrate.mjs || echo "[migrate] FAILED — continuing"
PORT=8090 node /api/dist/index.js &

# --- Tor v3 hidden service ---------------------------------------------------
# Expose the site over a stable .onion. Tor forwards onion:80 -> Caddy on $PORT
# (the same process that serves clearnet), so no extra web server is needed.
# The service key lives on a Railway volume at /var/lib/tor/hidden_service, which
# is what keeps the .onion address stable across deploys. SocksPort 0 disables
# the SOCKS proxy — this is a hidden-service publisher, not a relay or client.
# DataDirectory must be owned by the user Tor runs as (root here). The apk `tor`
# package pre-creates /var/lib/tor owned by its own `tor` user, which Tor rejects
# when we run as root — so keep DataDirectory on a separate root-owned path and
# put ONLY the persistent hidden-service key on the volume.
HS_DIR=/var/lib/tor/hidden_service   # Railway volume mount (persists the .onion)
DATA_DIR=/var/lib/tor-data
mkdir -p "$HS_DIR" "$DATA_DIR"
# Tor refuses these dirs unless they're 0700 and owned by the running user.
chmod 700 "$HS_DIR" "$DATA_DIR" 2>/dev/null || true
cat > /tmp/torrc <<EOF
SocksPort 0
RunAsDaemon 0
DataDirectory $DATA_DIR
HiddenServiceDir $HS_DIR
HiddenServicePort 80 127.0.0.1:${PORT:-80}
EOF
tor -f /tmp/torrc &
# Log the onion hostname once Tor has published it (handy for the footer link).
( for i in $(seq 1 30); do
    if [ -f "$HS_DIR/hostname" ]; then
      echo "[tor] hidden service: http://$(cat "$HS_DIR/hostname")"
      break
    fi
    sleep 1
  done ) &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
