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
import { requireAdmin, requireProject } from "@/lib/actor";
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
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const status =
    statusParam === "dismissed" ? "dismissed" : statusParam === "all" ? "all" : "pending";
  // Scoped to the actor's org (supers see everything): rows carry the producing
  // team's role names, which are admin-only PII.
  const [rows, aliases] = await Promise.all([listInbox(status, g.actor), listAliases()]);
  return Response.json({ rows, count: rows.length, aliases });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

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
        // Ownership comes from the ROW's org, not the actor's — see
        // createProjectFromInbox. A CDS admin cannot promote a Spark-sourced row.
        const projectId = await createProjectFromInbox(id, g.actor);
        if (projectId === "forbidden") {
          return Response.json(
            { error: "That row came from another team's tracker." },
            { status: 403 }
          );
        }
        if (!projectId) return Response.json({ error: "Row not found" }, { status: 404 });
        revalidateTag("projects");
        return Response.json({ ok: true, projectId });
      }
      if (body.action === "merge") {
        const projectId = String(body.projectId || "").trim();
        if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
        // Two-sided: the row's feed AND the target project must both be the
        // actor's. Checked before the durable alias is written.
        const ok = await mergeInboxRow(id, projectId, g.actor);
        if (ok === "forbidden") {
          return Response.json(
            { error: "The row or the target project belongs to another team." },
            { status: 403 }
          );
        }
        if (!ok) return Response.json({ error: "Row or project not found" }, { status: 404 });
        revalidateTag("projects");
        return Response.json({ ok: true, projectId });
      }
      if (body.action === "dismiss") {
        if (!(await dismissInboxRow(id, g.actor))) {
          return Response.json({ error: "Row not found or not yours." }, { status: 404 });
        }
        return Response.json({ ok: true });
      }
      // restore
      if (!(await restoreInboxRow(id, g.actor))) {
        return Response.json({ error: "Row not found or not yours." }, { status: 404 });
      }
      return Response.json({ ok: true });
    }
    case "remove-alias": {
      const nameKey = String(body.nameKey || "").trim();
      if (!nameKey) return Response.json({ error: "nameKey required" }, { status: 400 });
      // Scoped by the owner of the project the alias points at: deleting it changes
      // what that team's next sync matches.
      if (!(await removeAlias(nameKey, g.actor))) {
        return Response.json(
          { error: "Alias not found, or its project belongs to another team." },
          { status: 404 }
        );
      }
      revalidateTag("projects");
      return Response.json({ ok: true });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
