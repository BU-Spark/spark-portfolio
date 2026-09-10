/**
 * Self-check for stripSslMode.
 *
 *   node --experimental-strip-types src/lib/db.test.ts
 *
 * This one line decides whether production can reach Postgres at all: leaving
 * `sslmode=require` in the URL makes pg demand a verifiable certificate, which
 * Railway's self-signed TCP proxy cannot present.
 */
import assert from 'node:assert/strict';
import { stripSslMode } from './db.ts';

const HOST = 'postgresql://u:p@altaria.proxy.rlwy.net:52027/railway';
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${(e as Error).message.split('\n')[0]}`);
    failed++;
  }
}

check('strips sslmode', () => {
  assert.ok(!stripSslMode(`${HOST}?sslmode=require`).includes('sslmode'));
});

check('strips sslmode in any case, and verify-full too', () => {
  for (const q of ['?SSLMode=REQUIRE', '?sslmode=verify-full', '?sslmode=disable'])
    assert.ok(!/sslmode/i.test(stripSslMode(HOST + q)));
});

check('strips uselibpqcompat', () => {
  assert.ok(!stripSslMode(`${HOST}?uselibpqcompat=true&sslmode=require`).includes('sslmode'));
});

check('keeps other params, and keeps credentials + host + port + database', () => {
  const out = stripSslMode(`${HOST}?sslmode=require&application_name=bounties`);
  assert.ok(out.includes('application_name=bounties'));
  assert.ok(out.startsWith('postgresql://u:p@altaria.proxy.rlwy.net:52027/railway'));
});

check('a URL with no sslmode is returned byte-identical', () => {
  assert.equal(stripSslMode(HOST), HOST);
  // No normalising round-trip through URL(): an untouched string must not change.
  assert.equal(stripSslMode(`${HOST}?application_name=x`), `${HOST}?application_name=x`);
});

check('an unparseable string is passed through rather than throwing', () => {
  assert.equal(stripSslMode('not a url ?sslmode=require'), 'not a url ?sslmode=require');
});

check('a password containing reserved characters survives', () => {
  // Percent-encoded, as it must be in a URL.
  const u = 'postgresql://app:p%40ss%3Aword@h:5432/db?sslmode=require';
  const out = stripSslMode(u);
  assert.ok(out.includes('p%40ss%3Aword'), out);
  assert.ok(!out.includes('sslmode'));
});

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
