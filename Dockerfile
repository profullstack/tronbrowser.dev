# Deploy target for the tronbrowser.dev Railway service: the static marketing
# site (homepage + install.sh) under apps/web/public. The rest of the monorepo
# (desktop, services, packages) deploys separately as it lands.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY apps/web/public/ /srv/
