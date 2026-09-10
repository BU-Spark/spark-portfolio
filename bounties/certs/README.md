# certs/

`railway-postgres-root-ca.pem` — the root CA that signs the certificate served
by the bounties Postgres instance on Railway's TCP proxy
(`altaria.proxy.rlwy.net:52027`).

**This is a public certificate, not a secret.** It is committed on purpose:
Hyperdrive needs it uploaded to Cloudflare before it will connect, and having
it in the repo means that step does not depend on someone re-deriving it.

## Why it exists

Railway's Postgres serves a certificate issued by a private CA:

```
subject : CN=localhost
issuer  : CN=root-ca
SAN     : DNS:localhost, DNS:postgres-b1fc.railway.internal
```

Two consequences, both verified against the live server:

- **`verify-full` can never pass.** The SAN does not include the proxy
  hostname we actually connect to, and we do not control certificate issuance.
- **`verify-ca` passes with this CA.** Chain validates, hostname is not
  checked.

Re-extract it any time with (the server presents its own root in the chain):

```bash
node scripts/dump-db-cert.mjs
```

## Rotation

Valid `2026-09-02` to `2028-11-30`. Railway regenerates it if the Postgres
service is recreated. If Hyperdrive starts failing to connect, re-run the
script above, compare, and re-upload.
