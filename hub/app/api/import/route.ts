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
import { runImport, type IncomingRow } from "@/lib/import";
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

  let body: { rows?: IncomingRow[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return Response.json({ error: "No rows provided." }, { status: 400 });
  }

  return Response.json(await runImport(rows, org));
}
