// The escalation queue: everything currently waiting on a person, plus the
// standing data-quality backlog.
//
// Scoped to the caller's team (supers see all). This is a WORKLIST, so unlike
// /api/projects — where foreign rows stay visible so a mis-filed project is
// noticeable to whoever would recognise the mistake — rows you can't act on are
// pure noise and are filtered out. Same rule listUploadRequests already follows.
import { requireAdmin } from "@/lib/actor";
import { listOpenApprovals, backlogCounts } from "@/lib/db";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const [items, backlog] = await Promise.all([
    listOpenApprovals(g.actor),
    backlogCounts(g.actor),
  ]);
  return Response.json({ items, backlog, org: g.actor.org, isSuper: g.actor.isSuper });
}
