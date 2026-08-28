// Community suggestion intake. Any signed-in @bu.edu account may propose missing
// metadata for a project it can see. Nothing here writes to `projects` — the payload
// is staged for admin review (lib/db.ts project_suggestions).
//
// THREE GUARDS, each closing a different hole:
//
// 1. SESSION. Not `requireAdmin` — that would defeat the point — but not anonymous
//    either. A signed-in @bu.edu identity is what makes a submission attributable,
//    and attribution is the only thing discouraging abuse of a queue humans read.
//
// 2. READ SCOPE. The project must be BU-visible. Without this, a viewer could
//    suggest against a `hidden` or `restricted` project id and learn it exists —
//    and confirm its existence from the response. Suggestion is not a side channel
//    for enumerating the catalogue.
//
// 3. RATE. Three pending suggestions per person per project. A signed-in account
//    should not be able to bury the review queue for a project it merely reads.
//    Counted in the DB rather than in memory because the Worker has no shared
//    memory across isolates.
import { auth } from "@/auth";
import {
  getProjectForViewer,
  createSuggestion,
  countPendingSuggestions,
  getGallerySettings,
} from "@/lib/db";
import { coerceSuggestion } from "@/lib/suggest";

const MAX_PENDING_PER_PROJECT = 3;

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    return Response.json({ error: "Sign in to suggest an edit." }, { status: 401 });
  }

  let body: { projectId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return Response.json({ error: "projectId is required." }, { status: 400 });
  }

  // Read scope, not existence. A hidden/restricted project is reported as "not
  // found" so the response cannot distinguish "no such project" from "not for you".
  const project = await getProjectForViewer(projectId);
  if (!project) {
    return Response.json({ error: "No such project." }, { status: 404 });
  }

  // Topics are constrained to the live vocabulary, which is admin-configurable —
  // so read it rather than importing the compile-time default, or a term an admin
  // added would be silently dropped.
  const settings = await getGallerySettings();
  const payload = coerceSuggestion(body, { topicVocabulary: settings.topics });
  if (!payload) {
    return Response.json(
      { error: "Nothing usable to suggest. Add a description, a link, tech tags or a note." },
      { status: 400 }
    );
  }

  const pending = await countPendingSuggestions(projectId, email);
  if (pending >= MAX_PENDING_PER_PROJECT) {
    return Response.json(
      {
        error: `You already have ${pending} suggestions awaiting review on this project. ` +
          `They'll be looked at before you can add more.`,
      },
      { status: 429 }
    );
  }

  const id = await createSuggestion({ projectId, submittedBy: email, payload });
  // No revalidateTag: nothing public changed. The cache is busted on ACCEPT.
  return Response.json({ ok: true, id, fields: Object.keys(payload) }, { status: 201 });
}
