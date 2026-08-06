// CSV import for the admin page. Runs the shared importer directly, scoped to the
// signed-in admin's team.
//
// This route used to be a proxy: it checked the session, then HTTP-fetched
// /api/import with the machine IMPORT_TOKEN. That discarded the admin's identity
// at the fetch boundary, so any admin could push rows that patched ANY project in
// either org, and no permission check placed on /api/import could ever see who
// asked. Calling runImport() directly with the actor's org is what closes it.
//
// Removing the fetch also removed a live bug: the base URL was built from
// NEXTAUTH_URL || VERCEL_URL || "http://localhost:3000", and VERCEL_URL does not
// exist on Cloudflare Workers — so on the current deploy it resolved to localhost
// and the import failed outright. Deleting the sub-request fixes that by
// construction rather than by adding another env-var fallback.
import { requireAdmin } from "@/lib/actor";
import { runImport, type IncomingRow } from "@/lib/import";

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

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

  // The org comes from the resolved session, never from the request body — a
  // client-supplied org would reopen exactly the hole this route used to be.
  // Rows naming another team's project come back in `crossOrg` rather than being
  // silently skipped or turned into duplicate inbox entries.
  return Response.json(await runImport(rows, g.actor.org));
}
