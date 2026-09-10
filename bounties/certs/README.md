# certs/

`railway-postgres-root-ca.pem` — the root CA that signs the certificate served
by the bounties Postgres instance on Railway's TCP proxy
(`altaria.proxy.rlwy.net:52027`). Hyperdrive needs it uploaded to Cloudflare.

## "Where does this come from? It isn't in the Railway interface."

It isn't, and it never will be. Railway's Postgres runs the
[`postgres-ssl`](https://github.com/railwayapp-templates/postgres-ssl) image,
whose `init-ssl.sh` generates a private CA *inside the container* on first
boot and writes it to the data volume:

```
/var/lib/postgresql/data/certs/root.crt   # this file
/var/lib/postgresql/data/certs/root.key   # stays on the server, never leaves
```

There is no export in the Railway dashboard and no `railway` CLI command for
it (checked: no cert/ssl subcommand exists). Nothing is missing and no
permission is required — the certificate is simply not surfaced there.

**So we take it off the wire instead.** A TLS server hands its chain to every
client during the handshake, before authentication, and this one includes its
own root. That is what `scripts/dump-db-cert.mjs` does: it sends a Postgres
`SSLRequest` packet to trigger the TLS upgrade, then writes out each
certificate presented.

```bash
node scripts/dump-db-cert.mjs      # rewrites this directory
node scripts/check-db-tls.mjs      # proves the CA actually validates the chain
```

(`openssl s_client -starttls postgres` does the same job, but LibreSSL on
macOS has no such flag, which is one reason the script exists.)

## "Shouldn't it be gitignored?"

No. This is a **public certificate, not a secret**, and committing it is the
point.

- It contains a public key and metadata. No private key — `root.key` never
  leaves the server. Verify: `grep -c "PRIVATE KEY"` on this file returns 0.
- The server already gives it to anyone who opens a TLS connection. Hiding it
  in the repo protects nothing.
- Trusting a CA is a *client-side* decision. Publishing which CA we expect is
  how certificate pinning is supposed to work, the same way a `known_hosts`
  entry or a pinned CA bundle gets committed.

The secret in this system is the database password, which lives in
`.dev.vars` and as a Cloudflare secret — never here.

## What it is

```
subject : CN=root-ca
issuer  : CN=root-ca          (self-signed root)
valid   : 2026-09-02 -> 2028-11-30
```

The leaf it signs is `CN=localhost`, with
`SAN: DNS:localhost, DNS:postgres-b1fc.railway.internal`. The proxy hostname
we connect to is not in that list, which is why Hyperdrive must use
`verify-ca` and can never use `verify-full`.

## Rotation

Less fragile than it looks. `init-ssl.sh` is deliberately idempotent and, in
its own words, "a re-execution must not rotate a CA that clients have pinned
into their trust stores". On restart it reissues only the *server leaf* from
the existing CA. **This file survives restarts and redeploys.**

It changes only if the data volume is recreated — a new database, or a
restore that loses `/var/lib/postgresql/data/certs/`. Default lifetime is 820
days (`SSL_CERT_DAYS`), and the leaf is reissued automatically within 30 days
of expiry.

If Hyperdrive ever fails to connect, run `node scripts/check-db-tls.mjs`. A
failure there means the CA changed: re-extract, re-upload to Cloudflare, and
point the Hyperdrive config at the new certificate id.
