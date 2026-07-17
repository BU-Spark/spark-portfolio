// Admin-only person profile API. GET → the full profile (identity, derived role
// stints + per-term project breakdown for SparkFlow, project list, stats). Staff
// PII — never exposed publicly; requires an authenticated admin session.
import { auth } from "@/auth";
import { getPersonProfile } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const profile = await getPersonProfile(id);
  if (!profile) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ profile });
}
