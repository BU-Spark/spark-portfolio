// Admin-only people directory API.
//   GET   → { people }  (curated staff directory: name, email, derived roles, #projects)
//   PATCH → update one person's email / notes / aliases
//   POST  → { action: "merge", sourceId, targetId }  fold one person into another
// All require an authenticated admin session. The directory is staff PII and is
// NEVER exposed on any public route.
import { requireAdmin, requireSuper } from "@/lib/actor";
import { listPeople, mergePeople, updatePerson, deletePerson, getPersonTimeline, addPerson } from "@/lib/db";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { searchParams } = new URL(req.url);
  const timelineId = searchParams.get("timeline");
  if (timelineId) {
    const timeline = await getPersonTimeline(timelineId);
    return Response.json({ timeline });
  }
  const people = await listPeople();
  return Response.json({ people });
}

export async function PATCH(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Missing or invalid id" }, { status: 400 });
  }

  const patch: { name?: string; email?: string | null; notes?: string | null; aliases?: string[] } = {};
  if (body.name !== undefined && String(body.name).trim())
    patch.name = String(body.name).trim();
  if (body.email !== undefined)
    patch.email = body.email ? String(body.email).trim() : null;
  if (body.notes !== undefined)
    patch.notes = body.notes ? String(body.notes).trim() : null;
  if (body.aliases !== undefined)
    patch.aliases = Array.isArray(body.aliases)
      ? (body.aliases as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
      : [];

  await updatePerson(id, patch);
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.action === "add") {
    const name = String(body.name ?? "").trim();
    if (!name) return Response.json({ error: "A name is required." }, { status: 400 });
    const email = body.email !== undefined && body.email ? String(body.email).trim() : null;
    const notes = body.notes !== undefined && body.notes ? String(body.notes).trim() : null;
    const aliases = Array.isArray(body.aliases)
      ? (body.aliases as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
      : [];
    const result = await addPerson({ name, email, notes, aliases });
    if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ ok: true, id: result.id });
  }

  if (body.action === "merge") {
    const sourceId = Number(body.sourceId);
    const targetId = Number(body.targetId);
    if (
      !Number.isInteger(sourceId) || sourceId <= 0 ||
      !Number.isInteger(targetId) || targetId <= 0
    ) {
      return Response.json({ error: "Missing or invalid sourceId/targetId" }, { status: 400 });
    }
    const ok = await mergePeople(sourceId, targetId);
    if (!ok) return Response.json({ error: "Merge target not found" }, { status: 404 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  // Super-only, tightening the "people are shared" rule for this ONE verb.
  // deletePerson cascades person_roles for EVERY project, so a scoped admin could
  // erase a person's entire history on the other team's projects. Unlike a bad
  // mergePeople — reversible by hand, since the source name survives as an alias
  // on the target — this is irrecoverable. It's also rare, so the super round-trip
  // costs almost nothing.
  const g = await requireSuper();
  if (!g.ok) return g.res;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Missing or invalid id" }, { status: 400 });
  }

  await deletePerson(id);
  return Response.json({ ok: true });
}
