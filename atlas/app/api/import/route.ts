// PD-sync ingestion endpoint. The Google Apps Script (scripts/pd-sync.gs) reads
// the PM-tracker tabs under a BU identity — the one thing the server can't do,
// since the PD docs are bu.edu-restricted — and POSTs rows here.
//
// Auth: a shared secret (IMPORT_TOKEN), since Apps Script can't perform the Google
// session sign-in the admin UI uses. Sent as `Authorization: Bearer …`.
//
// The row-processing logic lives in lib/import.ts and is shared with the admin CSV
// route. This handler is only the token gate plus the org decision.
import { timingSafeEqual } from "node:crypto";
import { runImport, coerceRows } from "@/lib/import";
import { ORGS } from "@/lib/authz";

// Constant-time bearer-token check (avoids leaking the secret via timing).
function bearerMatches(header: string | null, token: string): boolean {
  const a = Buffer.from(header || "");
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const token = process.env.IMPORT_TOKEN;
  if (!token) {
    return Response.json(
      { error: "Import is not configured (IMPORT_TOKEN unset)." },
      { status: 503 }
    );
  }
  if (!bearerMatches(req.headers.get("authorization"), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Which team's catalog this feed may write to. Configuration, not request data:
  // the token holder must never be able to nominate its own scope, or the shared
  // secret becomes an org-boundary bypass. `body.org` is deliberately not read.
  //
  // Validated rather than defaulted-through, because a typo ("sparkk") would
  // otherwise filter the candidate index to zero and the sync would report
  // "0 updated" forever with no error — silent death is the worst failure here.
  const org = (process.env.IMPORT_ORG ?? "spark").trim();
  if (!ORGS.includes(org as never)) {
    return Response.json(
      { error: `IMPORT_ORG is "${org}", which is not a known team.` },
      { status: 503 }
    );
  }

  let body: { rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // coerceRows drops non-object elements, so one malformed cell in the tracker feed
  // is reported as a bad row instead of throwing a 500 that fails the whole sync.
  const rows = coerceRows(body.rows);
  if (!rows.length) {
    return Response.json({ error: "No rows provided." }, { status: 400 });
  }

  // ?dry=1 renders what the sync would change and writes nothing — no project
  // update, no inbox row, no person_role, no cache bust. Mirrors the digest's flag.
  //
  // This is not a nicety. resolveRole overwrites staffing whenever the tracker has a
  // value, so a hand-corrected PM is reverted by the next sync with no warning. The
  // preview is the only way to see that coming, and the Apps Script never sets it, so
  // the scheduled feed is unaffected.
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  return Response.json(await runImport(rows, org, dry));
}
