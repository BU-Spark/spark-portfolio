/**
 * Client-IP resolution for rate-limit buckets.
 *
 *   node --experimental-strip-types src/lib/rate-limit.test.ts
 *
 * The bug this locks down: X-Forwarded-For was read FIRST. Cloudflare appends
 * the true client IP to any XFF the caller already sent, so its first entry is
 * attacker-controlled -- one caller could take a fresh bucket per request and
 * walk straight through the admin-login limiter.
 */
import assert from 'node:assert/strict';
import { getClientIp } from './rate-limit.ts';

let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${(e as Error).message.split('\n')[0]}`); failed++; }
}
const req = (h: Record<string, string>) => new Request('https://bounties.buspark.io/', { headers: h });

check('CF-Connecting-IP wins over a spoofed X-Forwarded-For', () => {
  assert.equal(
    getClientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })),
    '203.0.113.7'
  );
});

check('a client-chosen XFF cannot change the bucket when behind Cloudflare', () => {
  const keys = ['9.9.9.9', '8.8.8.8', 'garbage'].map((spoof) =>
    getClientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': spoof }))
  );
  assert.deepEqual(new Set(keys), new Set(['203.0.113.7']), 'every request must land in ONE bucket');
});

check('falls back to XFF off Cloudflare (local dev)', () => {
  assert.equal(getClientIp(req({ 'x-forwarded-for': '10.0.0.5, 10.0.0.6' })), '10.0.0.5');
});

check('falls back to x-real-ip, then to a constant', () => {
  assert.equal(getClientIp(req({ 'x-real-ip': '10.0.0.9' })), '10.0.0.9');
  assert.equal(getClientIp(req({})), 'unknown');
});

console.log(failed === 0 ? '\nall passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
