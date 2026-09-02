/**
 * Slack slash-command request verification.
 *
 * A slash-command endpoint is a PUBLIC URL that returns student email
 * addresses, so the signature check is the only thing standing between the
 * roster and anyone who guesses the path. It is not optional.
 *
 * Slack signs each request as
 *   v0=HMAC_SHA256(signing_secret, "v0:" + timestamp + ":" + raw_body)
 * and sends the digest in X-Slack-Signature with the timestamp in
 * X-Slack-Request-Timestamp. See api.slack.com/authentication/verifying-requests
 *
 * Implemented on Web Crypto rather than node:crypto: this runs on Workers,
 * and Web Crypto is available without the nodejs_compat shim.
 */

/** Slack's own recommendation: reject anything older than five minutes. */
const MAX_SKEW_SEC = 60 * 5;

function timingSafeEqual(a: string, b: string): boolean {
  // Compare every byte regardless of where the first difference is, so the
  // duration of a failed comparison does not leak the correct prefix.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerifyResult {
  ok: boolean;
  /** Safe to show a caller; deliberately vague about which check failed. */
  reason?: string;
}

/**
 * Verify a Slack request. `rawBody` must be the EXACT bytes Slack sent — read
 * it with `await request.text()` before any parsing, because re-serialising
 * form data reorders and re-encodes it and the digest will not match.
 */
export async function verifySlackRequest(
  request: Request,
  rawBody: string,
  signingSecret: string | undefined
): Promise<VerifyResult> {
  if (!signingSecret) return { ok: false, reason: 'Server is missing SLACK_SIGNING_SECRET.' };

  const signature = request.headers.get('x-slack-signature');
  const timestamp = request.headers.get('x-slack-request-timestamp');
  if (!signature || !timestamp) return { ok: false, reason: 'Missing signature headers.' };

  // Replay guard: without this, a captured request works forever.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SEC) {
    return { ok: false, reason: 'Stale request.' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`)
  );

  return timingSafeEqual(`v0=${toHex(mac)}`, signature)
    ? { ok: true }
    : { ok: false, reason: 'Bad signature.' };
}

/**
 * An ephemeral reply — visible only to the person who ran the command, and
 * not persisted into the channel history.
 *
 * Every reply from this endpoint is ephemeral by construction. Rosters are
 * student PII; `in_channel` would broadcast them to everyone in the channel
 * and leave them in Slack's retained history, so the option is not exposed.
 */
export function ephemeral(text: string): Response {
  return new Response(JSON.stringify({ response_type: 'ephemeral', text }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
