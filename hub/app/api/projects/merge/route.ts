// Admin: merge two projects into one (e.g. the same project recorded separately
// across two semesters). The absorbed record is folded into the survivor and
// deleted; per-semester data (runs/roles/PD, contributors, role timeline) combines
// automatically. Requires an authenticated admin session.
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { mergeProjects, type MergeResolution } from "@/lib/db";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const survivorId = typeof body.survivorId === "string" ? body.survivorId.trim() : "";
  const absorbedId = typeof body.absorbedId === "string" ? body.absorbedId.trim() : "";
  if (!survivorId || !absorbedId) {
    return Response.json({ error: "survivorId and absorbedId are required" }, { status: 400 });
  }
  if (survivorId === absorbedId) {
    return Response.json({ error: "Cannot merge a project into itself" }, { status: 400 });
  }

  // Coerce the resolution — never trust the body blindly. Strings trimmed (empty →
  // null for nullable fields), booleans type-guarded. Anything omitted is left
  // undefined so mergeProjects falls back to the populated side.
  const raw = (body.resolution ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : undefined);
  const nstr = (k: string) =>
    raw[k] === undefined ? undefined : raw[k] ? String(raw[k]).trim() || null : null;
  const bool = (k: string) => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : undefined);
  const resolution: MergeResolution = {
    title: str("title"),
    blurb: str("blurb"),
    blurbFromAbsorbed: bool("blurbFromAbsorbed"),
    partner: str("partner"),
    clientType: str("clientType"),
    repoUrl: nstr("repoUrl"),
    prodUrl: nstr("prodUrl"),
    driveUrl: nstr("driveUrl"),
    techNote: nstr("techNote"),
    featured: bool("featured"),
    published: bool("published"),
  };

  const ok = await mergeProjects(survivorId, absorbedId, resolution);
  if (!ok) {
    return Response.json({ error: "Merge failed — one of the projects no longer exists." }, { status: 409 });
  }

  revalidateTag("projects"); // refresh cached public gallery/detail
  return Response.json({ ok: true, id: survivorId });
}
