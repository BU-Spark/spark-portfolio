"use client";
// Admin → Manage admins (the @bu.edu allowlist). Spark Control redesign: a
// PageHeader with an admin-count badge, an add-by-email card, and a list of
// admin rows with a gradient initials avatar, email + name + added-date, and a
// destructive Remove (confirm). The signed-in user's row is tagged "you" with
// Remove disabled (self-lockout guard). VISUAL refresh only — every behavior,
// field, and API call is preserved.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/admin/PageHeader";
import { useToast } from "@/components/admin/useToast";

interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
}

function initialsOf(s: string) {
  return (
    s
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export default function UsersPage() {
  const { toastEl, notify } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // Current admin's email for the "you"/self-lockout guard. Sourced from the
  // next-auth session endpoint (client-only) rather than useSession(), since the
  // app has no SessionProvider — useSession() would break prerender.
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setMe(s?.user?.email ?? null))
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.ok) setUsers((await res.json()).users);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify("err", data.error || "Could not add admin.");
      return;
    }
    notify(
      "ok",
      data.inserted
        ? `Added ${email}. They can now sign in with Google.`
        : `${email} is already an admin.`
    );
    setEmail("");
    refresh();
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Remove ${u.email}? They will lose admin access.`)) return;
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) notify("err", data.error || "Could not remove.");
    refresh();
  };

  return (
    <>
      {toastEl}
      <PageHeader eyebrow="Admin" title="Manage admins">
        <span className="badge b-draft" style={{ fontSize: 11 }}>
          {loading ? "…" : `${users.length} admin${users.length === 1 ? "" : "s"}`}
        </span>
      </PageHeader>

      <div className="content" style={{ maxWidth: 720 }}>
        <p className="subcopy" style={{ marginBottom: 24 }}>
          People here can sign in with their BU Google account to add and edit
          gallery projects. Add someone&apos;s <b>@bu.edu</b> email and they can
          sign in immediately — no password to set or send.
        </p>

        {/* Add admin */}
        <div className="card card-pad" style={{ padding: "18px 20px", marginBottom: 20 }}>
          <form
            onSubmit={add}
            style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <label className="lab" htmlFor="newemail">
                BU email
              </label>
              <input
                className="fld"
                id="newemail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@bu.edu"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="btn btn-teal"
              style={{ fontSize: 14, padding: "11px 20px" }}
            >
              {busy ? "Adding…" : "Add admin"}
            </button>
          </form>
        </div>

        {/* Admin list */}
        <div className="card" style={{ overflow: "hidden" }}>
          {loading ? (
            [0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--line-2)",
                }}
              >
                <div className="sk" style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sk" style={{ height: 15, width: "55%", marginBottom: 8 }} />
                  <div className="sk" style={{ height: 12, width: "30%" }} />
                </div>
                <div className="sk" style={{ height: 32, width: 80, borderRadius: 8 }} />
              </div>
            ))
          ) : users.length === 0 ? (
            <div className="empty">No admins yet.</div>
          ) : (
            users.map((u, i) => {
              const isMe = !!me && u.email.toLowerCase() === me.toLowerCase();
              return (
                <div
                  key={u.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 20px",
                    borderTop: i === 0 ? "none" : "1px solid var(--line-2)",
                  }}
                >
                  {/* Gradient avatar */}
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      flexShrink: 0,
                      background: "linear-gradient(140deg,#2b3a36,#16201d)",
                      display: "grid",
                      placeItems: "center",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--teal-bright)",
                    }}
                  >
                    {initialsOf(u.name || u.email)}
                  </div>

                  {/* Who */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "14.5px",
                        fontWeight: 500,
                        color: "var(--ink)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {u.email}
                      {isMe && (
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            color: "var(--teal-deep)",
                            background: "color-mix(in oklab,var(--teal) 12%,#fff)",
                            border: "1px solid color-mix(in oklab,var(--teal) 28%,#fff)",
                            borderRadius: 5,
                            padding: "1px 6px",
                          }}
                        >
                          you
                        </span>
                      )}
                    </div>
                    {u.name && (
                      <div style={{ fontSize: "12.5px", color: "var(--ink-3)", marginTop: 2 }}>
                        {u.name}
                      </div>
                    )}
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "10.5px",
                        color: "var(--ink-4)",
                        marginTop: 3,
                      }}
                    >
                      added {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => remove(u)}
                    disabled={isMe}
                    title={isMe ? "You can't remove your own access" : undefined}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "12.5px",
                      color: isMe ? "var(--ink-4)" : "var(--rose)",
                      border: `1px solid ${isMe ? "var(--line)" : "var(--rose-line)"}`,
                      background: isMe ? "var(--bg2)" : "var(--panel)",
                      borderRadius: 8,
                      padding: "7px 13px",
                      cursor: isMe ? "not-allowed" : "pointer",
                      flexShrink: 0,
                      transition: "all .15s",
                    }}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
