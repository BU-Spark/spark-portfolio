/**
 * Prove which TLS mode Hyperdrive must use against the bounties database.
 *
 *   node scripts/check-db-tls.mjs [ca.pem]   (default: certs/railway-postgres-root-ca.pem)
 *
 * Run this before creating the Hyperdrive config, and again if it ever stops
 * connecting. Expected today:
 *
 *   verify-full  FAIL  hostname is not in the cert's altnames
 *   verify-ca    OK    authorized=true
 *
 * verify-full is not a stricter option we are declining — Railway's cert
 * covers `localhost` and the *.railway.internal name, never the public proxy
 * hostname, and we do not control issuance. If verify-full ever starts
 * passing, Railway changed something and this file is out of date.
 */
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';

const HOST = 'altaria.proxy.rlwy.net';
const PORT = 52027;
const ca = fs.readFileSync(process.argv[2] ?? 'certs/railway-postgres-root-ca.pem');

/** Open a socket, ask Postgres to upgrade it, then hand it to TLS. */
function attempt(label, extra) {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, HOST, () => {
      const b = Buffer.alloc(8);
      b.writeInt32BE(8, 0);
      b.writeInt32BE(80877103, 4); // SSLRequest
      sock.write(b);
    });
    sock.once('data', (d) => {
      if (d.toString() !== 'S') return resolve({ label, ok: false, detail: 'server refused TLS' });
      const t = tls.connect({ socket: sock, ca, servername: HOST, ...extra }, () => {
        resolve({ label, ok: true, detail: `authorized=${t.authorized}` });
        t.destroy();
      });
      t.on('error', (e) => resolve({ label, ok: false, detail: e.message }));
    });
    sock.on('error', (e) => resolve({ label, ok: false, detail: e.message }));
  });
}

const full = await attempt('verify-full', {});
// verify-ca checks the chain but not the hostname, which is what Hyperdrive's
// verify-ca mode does.
const caOnly = await attempt('verify-ca', { checkServerIdentity: () => undefined });

for (const r of [full, caOnly]) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.label.padEnd(12)} ${r.detail}`);
}

if (caOnly.ok && !full.ok) {
  console.log('\nAs expected: create the Hyperdrive config with --sslmode verify-ca.');
  process.exit(0);
}
if (full.ok) {
  console.log('\nverify-full now passes — Railway reissued the certificate. Prefer verify-full.');
  process.exit(0);
}
console.error('\nverify-ca FAILED. The committed CA no longer matches the server.');
console.error('Re-extract it with: node scripts/dump-db-cert.mjs');
process.exit(1);
