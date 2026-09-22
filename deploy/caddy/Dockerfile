# Caddy with the Cloudflare DNS module, so certificates are issued through the
# Cloudflare API (works for proxied records and the *.derops.dev wildcard).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
