// Admin allowlist management.
//   GET  → list allowed admins
//   POST → add a @bu.edu email to the allowlist { email }
// Both require an authenticated admin session. There are no passwords: listed
// people sign in with Google (auth.ts gates on this list + the bu.edu domain).
import { auth } from "@/auth";
import { addAdminEmail, listUsers } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ users: await listUsers() });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  // Admins sign in with Google Workspace, so only @bu.edu can ever authenticate.
  if (!email.endsWith("@bu.edu")) {
    return Response.json(
      { error: "Only @bu.edu addresses can be admins." },
      { status: 400 }
    );
  }
  const inserted = await addAdminEmail(email, email.split("@")[0]);
  return Response.json({ ok: true, inserted });
}
