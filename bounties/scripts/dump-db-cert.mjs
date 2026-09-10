/**
 * Dump the TLS certificate chain served by the bounties Postgres instance.
 *
 *   node scripts/dump-db-cert.mjs [outDir]     (default: ./certs)
 *
 * Speaks just enough of the Postgres protocol to trigger the TLS upgrade
 * (an SSLRequest packet, magic 80877103) — the server presents no certificate
 * before that. `openssl s_client -starttls postgres` does the same job, but
 * LibreSSL on macOS does not support that flag.
 *
 * The server sends its own root, so the last file written is the CA that
 * Cloudflare needs for Hyperdrive. See certs/README.md.
 */
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
// Host is fixed rather than read from DATABASE_URL so this stays runnable
// without secrets present.
const [host, port] = ['altaria.proxy.rlwy.net', 52027];
const dir = process.argv[2] ?? 'certs';
fs.mkdirSync(dir, { recursive: true });
const sock = net.connect(port, host, () => {
  const b = Buffer.alloc(8); b.writeInt32BE(8, 0); b.writeInt32BE(80877103, 4); sock.write(b);
});
sock.once('data', (d) => {
  if (d.toString() !== 'S') process.exit(1);
  const t = tls.connect({ socket: sock, rejectUnauthorized: false, servername: host }, () => {
    let c = t.getPeerCertificate(true);
    const seen = new Set();
    let i = 0;
    while (c && c.raw && !seen.has(c.fingerprint256)) {
      seen.add(c.fingerprint256);
      const pem = '-----BEGIN CERTIFICATE-----\n' +
        c.raw.toString('base64').match(/.{1,64}/g).join('\n') +
        '\n-----END CERTIFICATE-----\n';
      const name = `${i}-${(c.subject.CN || 'cert').replace(/[^a-z0-9-]/gi, '_')}.pem`;
      fs.writeFileSync(`${dir}/${name}`, pem);
      console.log(`${name}  subject=${JSON.stringify(c.subject)} issuer=${JSON.stringify(c.issuer)} selfsigned=${JSON.stringify(c.subject)===JSON.stringify(c.issuer)}`);
      c = c.issuerCertificate; i++;
    }
    process.exit(0);
  });
  t.on('error', (e) => { console.log('tls error:', e.message); process.exit(1); });
});
