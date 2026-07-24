// Remove all admin-added projects.
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { clearCustomProjects } from "@/lib/db";

export async function POST() {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await clearCustomProjects();
  revalidateTag("projects");
  return Response.json({ ok: true });
}
