// Thin server-side proxy for the CSV import admin page.
// Auth-gated by session; forwards to /api/import with the IMPORT_TOKEN secret
// so the secret never reaches the browser.
import { auth } from "@/auth";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.IMPORT_TOKEN;
  if (!token) {
    return Response.json(
      { error: "Import is not configured (IMPORT_TOKEN unset)." },
      { status: 503 }
    );
  }

  let body: { rows?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return Response.json({ error: "No rows provided." }, { status: 400 });
  }

  // Build the absolute URL for the internal /api/import endpoint.
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const res = await fetch(`${baseUrl}/api/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ rows: body.rows }),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return Response.json(
      { error: "Import service returned a non-JSON response." },
      { status: 502 },
    );
  }
  return Response.json(data, { status: res.status });
}
