// Remove an admin user. Guards against locking everyone out: you can't delete
// your own account, and you can't delete the last remaining user.
import { requireSuper } from "@/lib/actor";
import { countSuperAdmins, countUsers, listUsers, removeUser } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireSuper();
  if (!g.ok) return g.res;

  const id = Number((await params).id);
  if (!Number.isFinite(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const users = await listUsers();
  const target = users.find((u) => String(u.id) === String(id));
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });

  if (target.email.toLowerCase() === g.actor.email.toLowerCase()) {
    return Response.json(
      { error: "You can't remove your own account." },
      { status: 400 }
    );
  }
  if ((await countUsers()) <= 1) {
    return Response.json(
      { error: "Can't remove the last admin user." },
      { status: 400 }
    );
  }
  // Third guard, and the one that matters most now. is_super is grantable only by
  // SQL, so deleting the final super admin would make granting admin, editing the
  // vocabulary, cross-org merges and ownership reassignment unreachable by ANY
  // account — recoverable only with direct database access.
  if (target.isSuper && (await countSuperAdmins()) <= 1) {
    return Response.json(
      { error: "Can't remove the last super admin — promote someone else first (SQL)." },
      { status: 400 }
    );
  }

  await removeUser(id);
  return Response.json({ ok: true });
}
