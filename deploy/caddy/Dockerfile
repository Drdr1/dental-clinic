# Caddy with the Cloudflare DNS module, so certificates are issued through the
# Cloudflare API (works for proxied records, the *.derops.dev wildcard and dentano.app).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
