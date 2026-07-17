// Single-project admin API.
//   GET    → full record (incl. admin-only students/teamId) for the edit form
//   PATCH  → partial update of project-level fields + runs
//   DELETE → remove the project
// All require an authenticated admin session.
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import {
  getProjectAdmin,
  removeProject,
  updateProject,
  type ProjectPatch,
} from "@/lib/db";
import type { Run } from "@/lib/types";
import { disciplineFromCourse, SURFACE_KEYS } from "@/lib/data";
import { publishBlockers } from "@/lib/project";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await getProjectAdmin(id);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ project });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const patch: ProjectPatch = {};
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.blurb === "string") patch.blurb = body.blurb.trim();
  if (typeof body.partner === "string") patch.partner = body.partner.trim();
  if (body.contact !== undefined)
    patch.contact = body.contact ? String(body.contact).trim() : null;
  // Admin-only contacts: [{name, email}]. Cleaning/blank-drop happens in updateProject.
  if (Array.isArray(body.contacts))
    patch.contacts = (body.contacts as Record<string, unknown>[]).map((c) => ({
      name: String(c?.name ?? "").trim(),
      email: String(c?.email ?? "").trim(),
    }));
  if (typeof body.clientType === "string") patch.clientType = body.clientType.trim();
  if (Array.isArray(body.tech))
    patch.tech = (body.tech as unknown[]).map(String).filter(Boolean);
  if (Array.isArray(body.images))
    patch.images = (body.images as unknown[]).map(String).filter(Boolean);
  if (body.repoUrl !== undefined)
    patch.repoUrl = body.repoUrl ? String(body.repoUrl).trim() : null;
  if (body.prodUrl !== undefined)
    patch.prodUrl = body.prodUrl ? String(body.prodUrl).trim() : null;
  if (typeof body.codePrivate === "boolean") patch.codePrivate = body.codePrivate;
  // These render as public hrefs, so only accept http(s) — never javascript:/data:.
  const httpOk = (u: string) => /^https?:\/\//i.test(u.trim());
  // The client ORG's website (hyperlinked on the public page).
  if (body.clientUrl !== undefined) {
    const u = body.clientUrl ? String(body.clientUrl).trim() : "";
    patch.clientUrl = u && httpOk(u) ? u : null;
  }
  // "About the client" blurb — plain text, rendered in an expandable dropdown.
  if (body.clientDesc !== undefined)
    patch.clientDesc = body.clientDesc ? String(body.clientDesc).trim() : null;
  // Which galleries this project surfaces on — whitelist to known keys; never
  // let it be emptied to nothing (default back to Spark so it stays visible).
  if (Array.isArray(body.surfaces)) {
    const s = (body.surfaces as unknown[]).map(String).filter((v) => SURFACE_KEYS.includes(v));
    patch.surfaces = s.length ? [...new Set(s)] : ["spark"];
  }
  if (Array.isArray(body.topics))
    patch.topics = (body.topics as unknown[])
      .map((t) => String(t).trim())
      .filter(Boolean);
  if (Array.isArray(body.datasets))
    patch.datasets = (body.datasets as Record<string, unknown>[])
      .map((d) => ({
        label: String(d?.label ?? "").trim(),
        url: String(d?.url ?? "").trim(),
      }))
      // Keep named datasets; a URL is optional but if present must be http(s)
      // (renders as a public href, so block javascript:/data:).
      .filter((d) => d.label && (!d.url || httpOk(d.url)));
  // Admin-only Google Drive folder link (empty → null so it can be cleared).
  if (body.driveUrl !== undefined)
    patch.driveUrl = body.driveUrl ? String(body.driveUrl).trim() : null;
  // Admin-only raw tech-stack note.
  if (body.techNote !== undefined)
    patch.techNote = body.techNote ? String(body.techNote).trim() : null;
  if (typeof body.blurbLocked === "boolean") patch.blurbLocked = body.blurbLocked;
  // NOTE: team roles + PD link are now PER-SEMESTER — parsed inside each run below,
  // not at the project level. updateProject cleans the role names (drops N/A etc).
  if (typeof body.featured === "boolean") patch.featured = body.featured;
  if (typeof body.published === "boolean") patch.published = body.published;
  if (Array.isArray(body.runs)) {
    const str = (v: unknown): string | null => {
      const s = String(v ?? "").trim();
      return s || null;
    };
    const runs: Run[] = (body.runs as Record<string, unknown>[])
      .map((r) => ({
        term: String(r.term ?? "").trim(),
        course: String(r.course ?? "").trim(),
        discipline: disciplineFromCourse(String(r.course ?? "").trim()) || String(r.discipline ?? "").trim(),
        students: Array.isArray(r.students)
          ? (r.students as unknown[]).map(String).filter(Boolean)
          : [],
        teamId: r.teamId ? String(r.teamId).trim() : null,
        // Admin-only per-semester team roles + PD link.
        sparkProgramLead: str(r.sparkProgramLead),
        pm: str(r.pm),
        tpm: str(r.tpm),
        seniorAdvisor: str(r.seniorAdvisor),
        techAdvisor: str(r.techAdvisor),
        eir: str(r.eir),
        eirIsInstructor: r.eirIsInstructor === true,
        classInstructors: Array.isArray(r.classInstructors)
          ? (r.classInstructors as unknown[]).map((s) => String(s).trim()).filter(Boolean)
          : [],
        pdUrl: str(r.pdUrl),
      }))
      .filter((r) => r.term && r.course);
    patch.runs = runs;
  }

  // Server-side publish gate: if the request is enabling publish, verify the
  // merged state (current + patch) has what it needs. Mirrors the client-side
  // canPublish check so direct API calls can't bypass it.
  if (patch.published === true) {
    const current = await getProjectAdmin(id);
    if (current) {
      const mergedBlurb = patch.blurb ?? current.blurb ?? "";
      const mergedRuns = patch.runs ?? current.runs ?? [];
      const blockers = publishBlockers({ blurb: mergedBlurb, runs: mergedRuns });
      if (blockers.length) {
        return Response.json(
          { error: `Cannot publish: missing ${blockers.join(", ")}` },
          { status: 422 }
        );
      }
    }
  }

  await updateProject(id, patch);
  revalidateTag("projects");
  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await removeProject(id);
  revalidateTag("projects");
  return Response.json({ ok: true });
}
