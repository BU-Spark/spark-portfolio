// Admin-gated import-inbox triage. The PD-sync importer drops every tracker row
// it can't match into `import_inbox` (see /api/import) so nothing is ever
// silently lost. Here an admin resolves each row:
//   - create        → seed a new (unpublished) catalog project from the row
//   - merge         → fold the row into an existing project + write a durable alias
//                     so the tracker name auto-matches on the next sync
//   - dismiss       → mark junk (header/contact cells); stays dismissed across syncs
//   - restore       → un-dismiss a row (return it to pending)
//   - remove-alias  → delete a DB-stored project alias by nameKey
// The inbox carries team-role names (admin-only PII), so all verbs are auth-gated.
import { auth } from "@/auth";
import {
  listInbox,
  listAliases,
  createProjectFromInbox,
  mergeInboxRow,
  dismissInboxRow,
  restoreInboxRow,
  removeAlias,
} from "@/lib/db";
import { revalidateTag } from "next/cache";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const status =
    statusParam === "dismissed" ? "dismissed" : statusParam === "all" ? "all" : "pending";
  const [rows, aliases] = await Promise.all([listInbox(status), listAliases()]);
  return Response.json({ rows, count: rows.length, aliases });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string; id?: unknown; projectId?: unknown; nameKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  switch (body.action) {
    case "create":
    case "merge":
    case "dismiss":
    case "restore": {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      if (body.action === "create") {
        const projectId = await createProjectFromInbox(id);
        if (!projectId) return Response.json({ error: "Row not found" }, { status: 404 });
        revalidateTag("projects");
        return Response.json({ ok: true, projectId });
      }
      if (body.action === "merge") {
        const projectId = String(body.projectId || "").trim();
        if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
        const ok = await mergeInboxRow(id, projectId);
        if (!ok) return Response.json({ error: "Row or project not found" }, { status: 404 });
        revalidateTag("projects");
        return Response.json({ ok: true, projectId });
      }
      if (body.action === "dismiss") {
        await dismissInboxRow(id);
        return Response.json({ ok: true });
      }
      // restore
      await restoreInboxRow(id);
      return Response.json({ ok: true });
    }
    case "remove-alias": {
      const nameKey = String(body.nameKey || "").trim();
      if (!nameKey) return Response.json({ error: "nameKey required" }, { status: 400 });
      await removeAlias(nameKey);
      revalidateTag("projects");
      return Response.json({ ok: true });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
