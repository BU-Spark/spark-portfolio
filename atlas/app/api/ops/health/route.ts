// Ops health check — the things a probe OUTSIDE the Worker cannot see.
//
// scripts/ops-blockers/check.mjs already probes what is reachable anonymously:
// the homepage serves, /api/img reports a missing object as 404, and the key in
// GitHub's secrets is accepted by Resend. Every one of those checks reads. None
// of them can see the Worker's own secrets or exercise a write.
//
// Both of the outages this was built after would have shown green:
//
//   1. Image uploads returned a blank 500 for days. Reads were fine the whole
//      time; the WRITE was failing, and the AWS SDK could not report it because
//      parsing an S3 error response needs DOMParser, which workerd does not
//      have. Fixed by preferring the native R2 binding (lib/s3.ts).
//   2. RESEND_API_KEY on the Worker was revoked while a valid key sat in local
//      and repo config. emailConfigured() in lib/email.ts only checks the key
//      EXISTS, so the UI reported email as available and every invite failed.
//
// So this route runs inside the Worker, where the real credentials live, and
// does the write and the authenticated call for real.
//
// AUTH: a shared secret as `Authorization: Bearer …`, same pattern as
// /api/digest/weekly and /api/import. No session, because the caller is a
// scheduler rather than a person. OPS_HEALTH_TOKEN is preferred; DIGEST_TOKEN
// is accepted as a fallback because it already exists both as a Worker secret
// and as a repo secret, which means this ships without waiting on anyone with
// Cloudflare access. The tradeoff, stated plainly: a leaked DIGEST_TOKEN can
// also trigger this endpoint's one-byte R2 round-trip. Set OPS_HEALTH_TOKEN to
// separate them.
//
// NOTHING SECRET GOES IN THE RESPONSE. Reasons are short and fixed — "write
// rejected", "key rejected (401)" — never a raw provider payload, which can
// echo a bucket name, an endpoint, or a credential back to the caller.
import { timingSafeEqual } from "node:crypto";
import {
  putObject,
  getObject,
  deleteObject,
  storageBackend,
  S3ConfigError,
  S3WriteError,
} from "@/lib/s3";
import { query } from "@/lib/db";

// Constant-time bearer check, so a wrong token cannot be discovered by timing.
// Duplicated from the digest route rather than shared: it is three lines, and
// extracting it would put a crypto import into the module graph of every route
// that imported the helper.
function bearerMatches(header: string | null, token: string): boolean {
  const a = Buffer.from(header || "");
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Check = { ok: boolean; [k: string]: unknown };

// A key under its own prefix so it is obvious what wrote it if a probe object
// ever survives a crash. Fixed rather than random: a random key per run would
// litter the bucket on every failed cleanup instead of overwriting one object.
const PROBE_KEY = "ops-health/probe.txt";

/**
 * Write, read back, compare, delete.
 *
 * The comparison matters: a put that "succeeds" against a misconfigured bucket
 * and a get that returns something else is a failure the status code alone does
 * not show. The delete runs in `finally` so a failed read cannot leave the
 * probe object behind.
 */
async function checkStorage(): Promise<Check> {
  const backend = await storageBackend();
  if (backend === "unconfigured") {
    return { ok: false, backend, reason: "object storage is not configured" };
  }

  const payload = `ops-health ${Date.now()}`;
  const expected = new TextEncoder().encode(payload);
  let wrote = false;

  try {
    await putObject(PROBE_KEY, expected, "text/plain");
    wrote = true;

    const got = await getObject(PROBE_KEY);
    if (!got) return { ok: false, backend, reason: "wrote the object but could not read it back" };

    const actual = new Uint8Array(await new Response(got.body).arrayBuffer());
    const same =
      actual.length === expected.length && actual.every((byte, i) => byte === expected[i]);
    if (!same) return { ok: false, backend, reason: "read back different bytes than were written" };

    // Green on the SDK path is still a problem: it means the binding is absent
    // and every future error will be unreportable, so say so rather than
    // returning a clean ok.
    if (backend !== "binding") {
      return { ok: false, backend, reason: "served by the S3 API, not the R2 binding" };
    }
    return { ok: true, backend };
  } catch (e) {
    if (e instanceof S3ConfigError) return { ok: false, backend, reason: "storage not configured" };
    if (e instanceof S3WriteError) return { ok: false, backend, reason: "write rejected by the bucket" };
    return { ok: false, backend, reason: "storage threw an unexpected error" };
  } finally {
    if (wrote) {
      // Best effort. A failure here is not worth turning a healthy result red,
      // but it must never throw out of the finally and mask the real outcome.
      try {
        await deleteObject(PROBE_KEY);
      } catch {
        /* the next run overwrites the same key */
      }
    }
  }
}

/**
 * Is the WORKER's Resend key actually usable — not merely present.
 *
 * Deliberately does not send mail: delivery is not verifiable from here, and a
 * health check that emails someone every three hours is its own outage. Listing
 * domains is the cheapest authenticated call, and it answers the second
 * question too (is buspark.io verified), because a valid key sending from an
 * unverified domain still fails on every message.
 */
async function checkEmail(): Promise<Check> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "RESEND_API_KEY is not set on the Worker" };

  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // 401/403 is our key. Anything else is Resend having a bad day, and
      // reporting that as our blocker sends someone to rotate a working key.
      const ours = res.status === 401 || res.status === 403;
      return {
        ok: false,
        reason: ours ? `key rejected (${res.status})` : `Resend returned ${res.status}`,
        theirFault: !ours,
      };
    }
    const body = (await res.json()) as { data?: { name?: string; status?: string }[] };
    const domain = (body.data || []).find((d) => d.name === "buspark.io");
    const domainVerified = domain?.status === "verified";
    return domainVerified
      ? { ok: true, domainVerified }
      : { ok: false, domainVerified, reason: `buspark.io is ${domain?.status ?? "not registered"}` };
  } catch {
    return { ok: false, reason: "could not reach Resend" };
  }
}

/** Liveness only. No rows, no schema, no connection details in the response. */
async function checkDatabase(): Promise<Check> {
  try {
    const rows = await query<{ ok: number }>("SELECT 1 AS ok");
    return rows.length === 1 ? { ok: true } : { ok: false, reason: "query returned no rows" };
  } catch {
    return { ok: false, reason: "query failed" };
  }
}

async function run(req: Request): Promise<Response> {
  const token = process.env.OPS_HEALTH_TOKEN || process.env.DIGEST_TOKEN;
  // Fail closed. "No token configured" must never mean "allow": this endpoint
  // writes to the bucket and makes an authenticated call on the Worker's
  // behalf, so an unguarded version is worse than an absent one.
  if (!token) {
    return Response.json(
      { error: "Health check is not configured (set OPS_HEALTH_TOKEN or DIGEST_TOKEN)." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!bearerMatches(req.headers.get("authorization"), token)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Run them together: they touch different services, and a slow one should not
  // add its latency to the others on a route a scheduler waits on.
  const [storage, email, database] = await Promise.all([
    checkStorage(),
    checkEmail(),
    checkDatabase(),
  ]);

  const checks = { storage, email, database };
  const ok = Object.values(checks).every((c) => c.ok);

  // 503 when anything failed, so a probe can branch on the status code without
  // parsing the body.
  return Response.json(
    { ok, checks, checkedAt: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
