// Admin review queue for community suggestions.
//
// GET  — list by status, org-scoped (a worklist, so foreign rows are pure noise;
//        same rule as /api/upload-requests/bulk, unlike /admin/projects where
//        foreign rows stay visible so a mis-filed project is noticeable).
// POST — accept or reject one. Guarded with requireProject, so the reviewer must
//        have edit authority over the project the suggestion targets, not merely
//        admin-ness somewhere.
import { requireAdmin, requireProject } from "@/lib/actor";
import {
  listSuggestions,
  getSuggestion,
  reviewSuggestion,
  getProjectAdmin,
  updateProject,
} from "@/lib/db";
import { applicableFields } from "@/lib/suggest";
import { revalidateTag } from "next/cache";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const status = new URL(req.url).searchParams.get("status") || "pending";
  return Response.json({ suggestions: await listSuggestions(status, g.actor) });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let body: { id?: unknown; verdict?: unknown; note?: unknown; overwrite?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required." }, { status: 400 });
  }
  const verdict = body.verdict === "accepted" || body.verdict === "rejected" ? body.verdict : null;
  if (!verdict) {
    return Response.json({ error: `verdict must be "accepted" or "rejected".` }, { status: 400 });
  }

  const s = await getSuggestion(id);
  if (!s) return Response.json({ error: "No such suggestion." }, { status: 404 });
  if (s.status !== "pending") {
    return Response.json(
      { error: `Already ${s.status} by ${s.reviewedBy ?? "someone"}.` },
      { status: 409 }
    );
  }
  // Authority over the TARGET project, not just admin-ness. A CDS admin must not be
  // able to apply a suggestion onto a Spark project.
  const pg = await requireProject(s.projectId);
  if (!pg.ok) return pg.res;

  // Close the suggestion FIRST. The UPDATE is guarded on status='pending', so two
  // admins clicking accept concurrently means the second gets `false` here and the
  // project is written once — claiming the row before mutating anything is what
  // makes that safe.
  const claimed = await reviewSuggestion(
    id,
    verdict,
    g.actor.email,
    typeof body.note === "string" ? body.note.trim() || null : null
  );
  if (!claimed) {
    return Response.json({ error: "Someone else just reviewed this." }, { status: 409 });
  }

  if (verdict === "rejected") {
    return Response.json({ ok: true, id, verdict, applied: {} });
  }

  // Additive by default: only fields that are currently blank are written. An admin
  // who genuinely wants to replace curated content passes `overwrite: ["blurb"]`.
  const project = await getProjectAdmin(s.projectId);
  if (!project) return Response.json({ error: "Project vanished." }, { status: 409 });
  const overwrite = Array.isArray(body.overwrite)
    ? body.overwrite.filter((x): x is string => typeof x === "string")
    : [];
  const applied = applicableFields(s.payload, project, overwrite);

  if (Object.keys(applied).length) {
    await updateProject(s.projectId, applied);
    revalidateTag("projects");
  }
  // `applied` can legitimately be empty — e.g. the suggestion was only a
  // contributorsNote, or the gaps got filled between submission and review. The
  // suggestion is still accepted; the note is the deliverable.
  return Response.json({ ok: true, id, verdict, applied: Object.keys(applied) });
}
