// Admin-gated student-contributor management. Students are admin-only (project
// hard rule), so this whole route is auth-gated and the data never appears in
// any public payload. GET lists a project's contributors; PUT replaces the full
// set for a project (the edit form sends the whole list). Keyed per-semester via
// each row's `term`, since a project's team differs across runs.
import { requireAdmin, requireProject, requireProjects } from "@/lib/actor";
import { listContributors, setProjectContributors, type ContributorInput } from "@/lib/db";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
  const contributors = await listContributors(projectId);
  return Response.json({ contributors });
}

export async function PUT(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let body: { projectId?: unknown; contributors?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const projectId = String(body.projectId || "").trim();
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });

  // Contributors hang off project_id, so leaving this unscoped would be a side
  // door into the other team's projects — the roster is replaced wholesale.
  const pg = await requireProject(projectId);
  if (!pg.ok) return pg.res;
  if (!Array.isArray(body.contributors)) {
    return Response.json({ error: "contributors must be an array" }, { status: 400 });
  }

  const clean: ContributorInput[] = (body.contributors as Record<string, unknown>[]).map((c) => ({
    term: c.term ? String(c.term).trim() : null,
    firstName: c.firstName ? String(c.firstName).trim() : null,
    lastName: c.lastName ? String(c.lastName).trim() : null,
    githubUsername: c.githubUsername ? String(c.githubUsername).trim() : null,
    email: c.email ? String(c.email).trim() : null,
  }));

  await setProjectContributors(projectId, clean);
  const contributors = await listContributors(projectId);
  return Response.json({ ok: true, contributors });
}
