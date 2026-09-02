/**
 * Self-check for Slack request verification.
 *
 *   node --experimental-strip-types src/lib/slack.test.ts
 *
 * No test framework on purpose: this is one file guarding one trust boundary.
 */
import assert from 'node:assert/strict';
import { verifySlackRequest, ephemeral } from './slack.ts';

const SECRET = 'test_signing_secret';
const BODY = 'command=%2Fbounty-signups&text=plate-gallery&user_id=U123';

async function sign(body: string, ts: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${ts}:${body}`)
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}`;
}

function req(sig: string | null, ts: string | null): Request {
  const headers = new Headers();
  if (sig) headers.set('x-slack-signature', sig);
  if (ts) headers.set('x-slack-request-timestamp', ts);
  return new Request('https://example.test/api/slack/signups', { method: 'POST', headers });
}

const now = () => String(Math.floor(Date.now() / 1000));

const cases: [string, () => Promise<boolean>][] = [
  [
    'accepts a correctly signed, fresh request',
    async () => {
      const ts = now();
      return (await verifySlackRequest(req(await sign(BODY, ts), ts), BODY, SECRET)).ok;
    },
  ],
  [
    'rejects a tampered body (signature computed over different bytes)',
    async () => {
      const ts = now();
      const sig = await sign(BODY, ts);
      const tampered = BODY.replace('plate-gallery', 'other-bounty');
      return !(await verifySlackRequest(req(sig, ts), tampered, SECRET)).ok;
    },
  ],
  [
    'rejects a replayed request older than the skew window',
    async () => {
      const old = String(Math.floor(Date.now() / 1000) - 60 * 10);
      return !(await verifySlackRequest(req(await sign(BODY, old), old), BODY, SECRET)).ok;
    },
  ],
  [
    'rejects a signature made with the wrong secret',
    async () => {
      const ts = now();
      const sig = await sign(BODY, ts, 'wrong_secret');
      return !(await verifySlackRequest(req(sig, ts), BODY, SECRET)).ok;
    },
  ],
  [
    'rejects when the server has no signing secret configured',
    async () => {
      const ts = now();
      return !(await verifySlackRequest(req(await sign(BODY, ts), ts), BODY, undefined)).ok;
    },
  ],
  [
    'rejects missing signature headers',
    async () => !(await verifySlackRequest(req(null, null), BODY, SECRET)).ok,
  ],
  [
    'replies are always ephemeral (rosters are PII)',
    async () => {
      const body = await ephemeral('hi').json();
      return (body as { response_type: string }).response_type === 'ephemeral';
    },
  ],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    assert.equal(await run(), true);
    console.log(`  ok   ${name}`);
  } catch {
    console.error(`  FAIL ${name}`);
    failed++;
  }
}
console.log(failed === 0 ? `\n${cases.length} passed` : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
