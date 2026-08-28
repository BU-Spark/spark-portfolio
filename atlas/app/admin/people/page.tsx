"use client";
// People directory — Spark Control "network" redesign. A stat strip, role filter
// chips (tinted via SparkFlow's categorical role colors), search, and person cards
// (gradient avatar tinted by primary role, role chips, project count, no-email
// token). Click a card → the person profile (/admin/people/[id]) where the role
// journey + inline editing/merge live. "Add person" stays here. Admin-only route.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/admin/PageHeader";
import { useToast } from "@/components/admin/useToast";
import { color } from "@/components/admin/sparkFlowMath";

interface Person {
  id: string; name: string; email: string | null; aliases: string[];
  notes: string | null; roles: string[]; projectCount: number;
}

// Avatar/chip priority — highest-priority held role drives the avatar hue.
const ROLE_ORDER = [
  "Program Lead", "PM", "TPM", "EIR", "Mentor", "Senior Advisor", "Tech Advisor",
  "Judge", "Ambassador", "Guest Speaker", "Class Instructor", "Fellow", "Workshop Host",
];
function rankRole(r: string) { const i = ROLE_ORDER.indexOf(r); return i < 0 ? 999 : i; }
function initialsOf(n: string) { return n.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?"; }

export default function PeopleDirectoryPage() {
  const router = useRouter();
  const { toastEl, notify } = useToast();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeRoles, setActiveRoles] = useState<Set<string>>(new Set());

  // Add-person form
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addAliases, setAddAliases] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/people");
    if (res.ok) setPeople((await res.json()).people ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const roleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of people) for (const r of p.roles) m.set(r, (m.get(r) ?? 0) + 1);
    return m;
  }, [people]);
  const roleList = useMemo(
    () => [...roleCounts.keys()].sort((a, b) => rankRole(a) - rankRole(b)),
    [roleCounts]
  );
  const missingEmail = people.filter((p) => !p.email).length;
  const mentors = roleCounts.get("Mentor") ?? 0;
  const programLeads = roleCounts.get("Program Lead") ?? 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      const okRole = activeRoles.size === 0 || p.roles.some((r) => activeRoles.has(r));
      const okQ = !q || (p.name + " " + (p.email ?? "") + " " + p.roles.join(" ")).toLowerCase().includes(q);
      return okRole && okQ;
    });
  }, [people, query, activeRoles]);

  const toggleRole = (r: string) =>
    setActiveRoles((prev) => { const next = new Set(prev); next.has(r) ? next.delete(r) : next.add(r); return next; });

  const addPerson = async () => {
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add", name: addName.trim(), email: addEmail.trim() || null,
          aliases: addAliases.split(",").map((a) => a.trim()).filter(Boolean),
        }),
      });
      const d = await res.json();
      if (!res.ok) { notify("err", d?.error ?? "Couldn't add person."); return; }
      notify("ok", `Added ${addName.trim()}.`);
      setAddName(""); setAddEmail(""); setAddAliases(""); setAddOpen(false);
      refresh();
    } catch { notify("err", "Couldn't add person."); }
    finally { setAdding(false); }
  };

  const stats: { n: number | string; l: string; amber?: boolean }[] = [
    { n: people.length, l: "People" },
    { n: roleCounts.size, l: "Role types" },
    { n: mentors, l: "Mentors" },
    { n: programLeads, l: "Program leads" },
    { n: missingEmail, l: "Missing email", amber: true },
  ];

  return (
    <>
      {toastEl}
      <PageHeader eyebrow="Network" title="People">
        <button className="btn btn-teal" onClick={() => setAddOpen((o) => !o)}>
          {addOpen ? "Cancel" : "+ Add person"}
        </button>
      </PageHeader>

      <div className="content">
        {/* Add person */}
        {addOpen && (
          <div className="card card-pad" style={{ marginBottom: 22, display: "grid", gridTemplateColumns: "1.1fr 1fr 1.4fr auto", gap: 12, alignItems: "end" }}>
            <div><label className="lab">Full name</label><input className="fld" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Full name" autoFocus /></div>
            <div><label className="lab">Email</label><input className="fld" type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="email@bu.edu" /></div>
            <div><label className="lab">Aliases (comma-separated)</label><input className="fld" value={addAliases} onChange={(e) => setAddAliases(e.target.value)} placeholder="abby, a. gualda" /></div>
            <button className="btn btn-teal" onClick={addPerson} disabled={adding || !addName.trim()}>{adding ? "Adding…" : "Add"}</button>
          </div>
        )}

        {/* Stat strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 22 }}>
          {stats.map((s) => (
            <div key={s.l} className="card" style={{ padding: "16px 18px" }}>
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 24, color: s.amber ? "var(--amber)" : undefined }}>{loading ? "·" : s.n}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink-4)", marginTop: 5 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
          <div className="search" style={{ flex: 1, minWidth: 240, maxWidth: "none", width: "auto" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" strokeLinecap="round" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, role, or email…" />
          </div>
        </div>

        {/* Role filters */}
        {roleList.length > 0 && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 18 }}>
            {roleList.map((r) => {
              const on = activeRoles.has(r);
              return (
                <button
                  key={r}
                  onClick={() => toggleRole(r)}
                  style={{
                    fontFamily: "var(--mono)", fontSize: 11.5, borderRadius: 999, padding: "6px 13px 6px 10px",
                    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
                    border: on ? "1px solid transparent" : "1px solid var(--field)",
                    background: on ? color(r, "solid") : "var(--panel)",
                    color: on ? "#fff" : "var(--ink-2)", transition: "all .15s",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#fff" : color(r, "solid") }} />
                  {r} <span style={{ opacity: 0.6 }}>{roleCounts.get(r)}</span>
                </button>
              );
            })}
            {activeRoles.size > 0 && <button className="btn-sm" onClick={() => setActiveRoles(new Set())}>Clear</button>}
          </div>
        )}

        {/* Card grid */}
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card sk" style={{ height: 150 }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card empty">No people match.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
            {filtered.map((p) => {
              const sortedRoles = [...p.roles].sort((a, b) => rankRole(a) - rankRole(b));
              const primary = sortedRoles[0] ?? "Contributor";
              const shown = sortedRoles.slice(0, 3);
              const extra = sortedRoles.length - shown.length;
              return (
                <div
                  key={p.id}
                  className="card"
                  onClick={() => router.push(`/admin/people/${p.id}`)}
                  style={{ padding: "18px 19px", display: "flex", flexDirection: "column", gap: 13, cursor: "pointer" }}
                >
                  <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
                    <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: "grid", placeItems: "center", fontFamily: "var(--display)", fontWeight: 700, fontSize: 17, color: "#fff", background: `linear-gradient(150deg,${color(primary, "solid")},${color(primary, "deep")})` }}>
                      {initialsOf(p.name)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 15.5 }}>{p.name}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>{p.email || "no email on file"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {shown.map((r) => (
                      <span key={r} style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, borderRadius: 6, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 5, color: color(r, "deep"), background: color(r, "tint") }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color(r, "solid") }} />{r}
                      </span>
                    ))}
                    {extra > 0 && <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, borderRadius: 6, padding: "2px 7px", color: "var(--ink-4)", background: "var(--bg2)" }}>+{extra}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)" }}>{p.projectCount} project{p.projectCount === 1 ? "" : "s"}</span>
                    {!p.email && <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--amber)", background: "var(--amber-bg)", border: "1px solid var(--amber-line)", borderRadius: 5, padding: "1px 6px" }}>no email</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
