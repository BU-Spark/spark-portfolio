// Token-gated export for the nightly Atlas -> Airtable sync
// (scripts/airtable-sync/sync.mjs, run by .github/workflows/airtable-sync.yml).
//
// GitHub Actions has no database credentials, on purpose, so the sync reads
// Atlas through this route instead. It returns ONLY what the "Atlas
// End-of-Semester" Airtable base needs: one row per project, from its latest
// run. No students, no client contacts, no PD or Drive links.
//
// It does include two internal fields (team id, PM email), which is why it is
// bearer-gated and fails closed, same as /api/ops/health.
import { timingSafeEqual } from "node:crypto";
import { getAllProjectsAdmin, getPeopleMap } from "@/lib/db";
import { primaryRun } from "@/lib/project";
import { normalizeName } from "@/lib/gdocs";

function bearerMatches(header: string | null, token: string): boolean {
  const a = Buffer.from(header || "");
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const token = process.env.OPS_HEALTH_TOKEN || process.env.DIGEST_TOKEN;
  const noStore = { "Cache-Control": "no-store" };
  if (!token) return Response.json({ error: "Export is not configured." }, { status: 503, headers: noStore });
  if (!bearerMatches(req.headers.get("authorization"), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }

  const [projects, people] = await Promise.all([getAllProjectsAdmin(), getPeopleMap()]);
  const rows = projects.map((p) => {
    const run = primaryRun(p);
    const pm = (run?.pm || p.pm || "").trim();
    return {
      id: p.id,
      name: p.title,
      semester: run?.term || "",
      course: run?.course || "",
      team: run?.teamId || "",
      clientOrg: p.partner || "",
      pmEmail: pm ? people.get(normalizeName(pm))?.email ?? "" : "",
      status: p.status ?? "pending",
    };
  });
  return Response.json({ projects: rows, exportedAt: new Date().toISOString() }, { headers: noStore });
}
