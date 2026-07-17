// Admin project API.
//   GET  → { total, projects }  (every project incl. drafts, for the manager)
//   POST → create a project from the admin form
// Both require an authenticated admin session.
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import {
  addProject,
  getProjectsForList,
  type NewProject,
} from "@/lib/db";
import { disciplineFromCourse } from "@/lib/data";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Admin list projection — includes admin-only fields (team roles) for filtering.
  const projects = await getProjectsForList();
  return Response.json({ total: projects.length, projects });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const str = (k: string) => String(body[k] ?? "").trim();
  const arr = (k: string): string[] =>
    Array.isArray(body[k]) ? (body[k] as unknown[]).map(String).filter(Boolean) : [];
  // Admin-only contacts: [{name, email}]. Final trim/blank-drop happens in addProject.
  const contacts = Array.isArray(body.contacts)
    ? (body.contacts as Record<string, unknown>[]).map((c) => ({
        name: String(c?.name ?? "").trim(),
        email: String(c?.email ?? "").trim(),
      }))
    : [];

  // Admin sends a project + a `runs` array (one run for a manual add).
  const rawRuns = Array.isArray(body.runs)
    ? (body.runs as Record<string, unknown>[])
    : [];
  const runStr = (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    return s || null;
  };
  const runs = rawRuns
    .map((r) => ({
      term: String(r.term ?? "").trim(),
      course: String(r.course ?? "").trim(),
      discipline: disciplineFromCourse(String(r.course ?? "").trim()) || String(r.discipline ?? "").trim(),
      students: Array.isArray(r.students)
        ? (r.students as unknown[]).map(String).filter(Boolean)
        : [],
      teamId: r.teamId ? String(r.teamId).trim() : null,
      // Admin-only per-semester team roles + PD link (cleaned in addProject).
      sparkProgramLead: runStr(r.sparkProgramLead),
      pm: runStr(r.pm),
      tpm: runStr(r.tpm),
      seniorAdvisor: runStr(r.seniorAdvisor),
      techAdvisor: runStr(r.techAdvisor),
      eir: runStr(r.eir),
      eirIsInstructor: r.eirIsInstructor === true,
      classInstructors: Array.isArray(r.classInstructors)
        ? (r.classInstructors as unknown[]).map((s) => String(s).trim()).filter(Boolean)
        : [],
      pdUrl: runStr(r.pdUrl),
    }))
    .filter((r) => r.term && r.course);

  if (!str("title")) {
    return Response.json({ error: "Missing required: title" }, { status: 400 });
  }
  if (!runs.length) {
    return Response.json(
      { error: "At least one run with term, course, and discipline is required" },
      { status: 400 }
    );
  }

  const project: NewProject = {
    id: `${slugify(str("title"))}-${Date.now().toString(36)}`,
    title: str("title"),
    blurb: str("blurb"),
    clientType: str("clientType"),
    partner: str("partner"),
    contact: str("contact") || null,
    contacts,
    tech: arr("tech"),
    images: arr("images"), // S3 object keys
    runs,
    repoUrl: str("repoUrl") || null,
    prodUrl: str("prodUrl") || null,
    featured: false,
    published: typeof body.published === "boolean" ? body.published : true,
    custom: true,
  };

  await addProject(project);
  revalidateTag("projects"); // refresh the cached public gallery/detail
  return Response.json({ ok: true, id: project.id });
}
