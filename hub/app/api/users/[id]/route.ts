// Remove an admin user. Guards against locking everyone out: you can't delete
// your own account, and you can't delete the last remaining user.
import { auth } from "@/auth";
import { countUsers, listUsers, removeUser } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isFinite(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const users = await listUsers();
  const target = users.find((u) => String(u.id) === String(id));
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });

  if (session.user?.email && target.email.toLowerCase() === session.user.email.toLowerCase()) {
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

  await removeUser(id);
  return Response.json({ ok: true });
}
