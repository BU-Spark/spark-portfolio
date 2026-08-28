"use client";
// Admin — add a project to the Spark! gallery. Reached from the dashboard
// ("Add a project"). Reads/writes the shared database through /api/projects
// (auth-gated by middleware). Images upload to S3 via <ImageSlot>, which stores
// object keys on the project. Redesigned to the "Spark Control" handoff:
// sectioned form with rule-labels, admin-only teal markers, PD-doc fetch inset,
// tag inputs, four image slots, and a sticky sidebar (gallery status + recent).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  SPARK_CLIENT_TYPES,
  SPARK_TERMS,
  disciplineFromCourse,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  VISIBILITY_LABELS,
} from "@/lib/data";
// Discipline/client-type vocab is admin-configurable (see /admin/settings); the
// constants above are only the initial fallback until /api/settings loads.
import ImageSlot from "@/components/ImageSlot";
import PdBlurbFetch from "@/components/PdBlurbFetch";
import { primaryDiscipline, latestTerm, missingInfo } from "@/lib/project";
import type { Project, ProjectContact } from "@/lib/types";
import ContactsEditor from "@/components/admin/ContactsEditor";
import PageHeader from "@/components/admin/PageHeader";
import { useActor, orgLabel } from "@/components/admin/ActorContext";
import { useToast } from "@/components/admin/useToast";

// Session cache of the admin project list for instant repeat-visit paints.
const PROJECTS_CACHE_KEY = "spark:admin:projects:v1";

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="taginput">
      {value.map((tag) => (
        <span key={tag} className="tag">
          {tag}
          <button onClick={() => onChange(value.filter((x) => x !== tag))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={value.length ? "" : placeholder}
      />
    </div>
  );
}

interface FormState {
  title: string;
  blurb: string;
  pdUrl: string; // admin-only PD doc link → saved onto the run
  partner: string;
  contacts: ProjectContact[]; // admin-only contacts (name + email)
  clientType: string;
  term: string;
  course: string;
  teamId: string; // admin-only internal reference
  repoUrl: string;
  prodUrl: string;
  tech: string[];
  team: string[]; // students (admin-only — not shown publicly)
  images: (string | null)[]; // S3 object keys
  // Visibility at creation. Never offers 'public' from here — a brand-new record
  // has no images yet, and opting in to the gallery is a deliberate later step.
  visibility: string;
  status: string; // pipeline state — independent of `publish` (see PROJECT_STATUSES)
}

const BLANK: FormState = {
  title: "",
  blurb: "",
  pdUrl: "",
  partner: "",
  contacts: [],
  clientType: "",
  term: "",
  course: "",
  teamId: "",
  repoUrl: "",
  prodUrl: "",
  tech: [],
  team: [],
  images: [null, null, null, null],
  visibility: "internal",
  status: "pending",
};

export default function AddProjectPage() {
  const actor = useActor();
  const [form, setForm] = useState<FormState>(BLANK);
  const { toastEl, notify } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  // Live vocab from /api/settings (admin-configurable); falls back to constants.
  const [clientTypes, setClientTypes] = useState<string[]>(SPARK_CLIENT_TYPES);
  const [termOptions, setTermOptions] = useState<string[]>(SPARK_TERMS);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const data = await res.json();
      setTotal(data.total);
      setProjects(data.projects ?? []);
      // Cache for an instant paint on the next /admin visit (see mount effect).
      try {
        sessionStorage.setItem(
          PROJECTS_CACHE_KEY,
          JSON.stringify({ total: data.total, projects: data.projects ?? [] })
        );
      } catch {}
    }
  }, []);

  // Stale-while-revalidate: paint the cached list immediately (no ~1.5s blank
  // wait on the DB round-trip for repeat visits), then refresh in the background.
  // refresh() rewrites the cache, and every mutation calls refresh(), so the
  // cache can't drift from the server for long.
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(PROJECTS_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        setTotal(data.total ?? 0);
        setProjects(data.projects ?? []);
      }
    } catch {}
    refresh();
  }, [refresh]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s?.clientTypes?.length) setClientTypes(s.clientTypes);
      })
      .catch(() => {});
    fetch("/api/admin/terms")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.terms?.length) setTermOptions(d.terms); })
      .catch(() => {});
  }, []);

  const set =
    <K extends keyof FormState>(k: K) =>
    (v: FormState[K]) =>
      setForm((f) => ({ ...f, [k]: v }));
  const setVal =
    (k: keyof FormState) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const setImage = (i: number) => (key: string | null) =>
    setForm((f) => {
      const images = [...f.images];
      images[i] = key;
      return { ...f, images };
    });

  // Required to form one valid run + the project title. partner/client/blurb/discipline
  // are optional here (discipline is auto-derived from course; backfill the rest later).
  const required: (keyof FormState)[] = [
    "title",
    "term",
    "course",
  ];
  const missing = required.filter((k) => !String(form[k]).trim());
  const valid = missing.length === 0;

  const submit = async () => {
    if (!valid) {
      notify("err", `Please fill: ${missing.join(", ")}`);
      return;
    }
    setBusy(true);
    const payload = {
      title: form.title,
      blurb: form.blurb,
      partner: form.partner,
      contacts: form.contacts,
      clientType: form.clientType,
      repoUrl: form.repoUrl,
      prodUrl: form.prodUrl,
      tech: form.tech,
      images: form.images.filter(Boolean),
      visibility: form.visibility,
      status: form.status,
      runs: [
        {
          term: form.term,
          course: form.course,
          discipline: disciplineFromCourse(form.course) || "",
          students: form.team,
          teamId: form.teamId || null,
          pdUrl: form.pdUrl || null,
        },
      ],
    };
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "" }));
      notify("err", error || "Could not add the project.");
      return;
    }
    notify(
      "ok",
      true
        ? `"${form.title.trim()}" added to the gallery.`
        : `"${form.title.trim()}" saved as a draft.`
    );
    setForm(BLANK);
    refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this project? This cannot be undone.")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    refresh();
  };

  // One-click hide/show — flips published without opening the edit form.
  const togglePublish = async (p: Project) => {
    const nextPublished = p.published === false; // currently a draft → publish
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: nextPublished }),
    });
    notify(
      "ok",
      nextPublished
        ? `"${p.title}" is now visible in the gallery.`
        : `"${p.title}" hidden from the gallery.`
    );
    refresh();
  };

  const draftCount = projects.filter((p) => p.published === false).length;
  const needInfoCount = projects.filter((p) => missingInfo(p).length > 0).length;

  return (
    <>
      {toastEl}
      <PageHeader eyebrow="Catalog / Create" title="Add a project">
        {/* Read-only: ownership is set server-side from the session, never from this
            form, so a client can't create a project owned by the other team. It's
            shown because it also decides which gallery the project starts on. */}
        <span className="badge" title="New projects are owned by your team">
          Creating as {actor?.isSuper ? `super admin (${orgLabel(actor.org)})` : orgLabel(actor?.org)}
        </span>
        <Link href="/admin/projects" className="btn btn-ghost">
          Cancel
        </Link>
      </PageHeader>
      <div className="content">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 300px",
            gap: 22,
            alignItems: "start",
          }}
        >
          {/* Form */}
          <div className="card card-pad">
            <p className="subcopy" style={{ margin: "0 0 4px" }}>
              New projects appear in the public gallery immediately and are
              searchable by every facet.
            </p>

            {/* ── PUBLIC DETAILS ── */}
            <div className="seclabel">
              <span className="t">Public details</span>
              <span className="ln" />
            </div>

            <div className="field">
              <label className="lab">
                Project title <span className="req">*</span>
              </label>
              <input
                className="fld"
                value={form.title}
                onChange={setVal("title")}
                placeholder="e.g. Boston 311 Service Equity Dashboard"
              />
            </div>

            <div className="field">
              <label className="lab">Short description</label>
              {/* PD auto-fill control */}
              <div className="pdwrap">
                <div className="pl">Auto-fill from PD doc</div>
                <PdBlurbFetch
                  initialUrl={form.pdUrl}
                  onUrlChange={set("pdUrl")}
                  onFetched={(blurb) => set("blurb")(blurb)}
                />
              </div>
              <textarea
                className="fld"
                value={form.blurb}
                onChange={setVal("blurb")}
                placeholder="What the project does and who it helps…"
              />
              <div className="hint">
                One or two sentences shown on the card and detail view. Paste the
                PD doc URL to auto-fill, then review.
              </div>
            </div>

            <div className="row2" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
              <div className="field">
                <label className="lab">Client / partner</label>
                <input
                  className="fld"
                  value={form.partner}
                  onChange={setVal("partner")}
                  placeholder="Organization name"
                />
                <div className="hint">
                  The organization&apos;s name — e.g. City of Boston, The Boston
                  Globe.
                </div>
              </div>
              <div className="field">
                <label className="lab">Client type</label>
                <select
                  className="fld"
                  value={form.clientType}
                  onChange={setVal("clientType")}
                >
                  <option value="">Select…</option>
                  {clientTypes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row2" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
              <div className="field">
                <label className="lab">
                  Term <span className="req">*</span>
                </label>
                <select
                  className="fld"
                  value={form.term}
                  onChange={setVal("term")}
                >
                  <option value="">Select…</option>
                  {termOptions.map((tm) => (
                    <option key={tm} value={tm}>
                      {tm}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="lab">
                  Course <span className="req">*</span>
                </label>
                <input
                  className="fld"
                  value={form.course}
                  onChange={setVal("course")}
                  placeholder="e.g. DS488, DS519, DS539, DS549, DS594, CS506, XC475…"
                />
                {form.course && (
                  <div className="hint">
                    Discipline:{" "}
                    <b>
                      {disciplineFromCourse(form.course) ||
                        "unknown — update course code"}
                    </b>
                  </div>
                )}
              </div>
            </div>

            <div className="row2" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="field">
                <label className="lab">Project URL</label>
                <input
                  className="fld"
                  value={form.repoUrl}
                  onChange={setVal("repoUrl")}
                  placeholder="https://github.com/org/repo"
                />
                <div className="hint">
                  GitHub repo — shown as &ldquo;View project →&rdquo;. Leave blank
                  if none.
                </div>
              </div>
              <div className="field">
                <label className="lab">Live / production URL</label>
                <input
                  className="fld"
                  value={form.prodUrl}
                  onChange={setVal("prodUrl")}
                  placeholder="https://example.com"
                />
                <div className="hint">
                  Public demo — shown as &ldquo;View live →&rdquo;.
                </div>
              </div>
            </div>

            <div className="field">
              <label className="lab">Tech stack</label>
              <TagInput
                value={form.tech}
                onChange={set("tech")}
                placeholder="Python, React, D3.js…"
              />
              <div className="hint">
                Type and press Enter to add each technology.
              </div>
            </div>

            {/* ── ADMIN-ONLY FIELDS ── */}
            <div className="seclabel">
              <span className="t">Admin-only fields</span>
              <span className="adm">never public</span>
              <span className="ln" />
            </div>

            <div className="field adminmark">
              <label className="lab">Contacts (internal)</label>
              <ContactsEditor value={form.contacts} onChange={set("contacts")} />
              <div className="hint">
                Contact people for this project (name + email) — admin-only, never
                shown publicly. Add as many as needed.
              </div>
            </div>

            <div className="field adminmark">
              <label className="lab">Student team (internal)</label>
              <TagInput
                value={form.team}
                onChange={set("team")}
                placeholder="Add team member…"
              />
              <div className="hint">
                Type a name and press Enter. Stored for admin reference — student
                names are not shown publicly.
              </div>
            </div>

            <div className="field adminmark">
              <label className="lab">Team ID (internal)</label>
              <input
                className="fld"
                value={form.teamId}
                onChange={setVal("teamId")}
                placeholder="e.g. fa25-projecta"
              />
              <div className="hint">
                Airtable team identifier — admin reference only, never shown
                publicly.
              </div>
            </div>

            {/* ── IMAGES ── */}
            <div className="seclabel">
              <span className="t">Images</span>
              <span className="ln" />
            </div>

            <div className="field">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <span className="eyebrow">Cover</span>
                <span className="eyebrow">Additional (up to 3)</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.6fr 1fr 1fr",
                  gridTemplateRows: "auto auto",
                  gap: 8,
                }}
              >
                <ImageSlot
                  value={form.images[0]}
                  onChange={setImage(0)}
                  placeholder="Cover image"
                  radius={10}
                  aspectRatio="16 / 11"
                  style={{ gridRow: "span 2" }}
                />
                <ImageSlot
                  value={form.images[1]}
                  onChange={setImage(1)}
                  placeholder="Image 2"
                  radius={10}
                  aspectRatio="4 / 3"
                />
                <ImageSlot
                  value={form.images[2]}
                  onChange={setImage(2)}
                  placeholder="Image 3"
                  radius={10}
                  aspectRatio="4 / 3"
                />
                <ImageSlot
                  value={form.images[3]}
                  onChange={setImage(3)}
                  placeholder="Image 4"
                  radius={10}
                  aspectRatio="4 / 3"
                  style={{ gridColumn: "2 / 4" }}
                />
              </div>
              <div className="hint">
                Drag an image onto each slot (or click to browse). The first is
                the cover; up to four show in the detail view.
              </div>
            </div>

            {/* ── VISIBILITY + SUBMIT ── */}
            <div
              style={{
                marginTop: 14,
                paddingTop: 22,
                borderTop: "1px solid var(--line)",
              }}
            >
              <div
                style={{ marginBottom: 18 }}
              >
                <label
                  htmlFor="status"
                  style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: 6 }}
                >
                  Project status
                </label>
                <select
                  id="status"
                  className="fld"
                  value={form.status}
                  onChange={(e) => set("status")(e.target.value)}
                  style={{ maxWidth: 320 }}
                >
                  {PROJECT_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {PROJECT_STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12.5, color: "var(--ink-4)", marginTop: 4 }}>
                  Where the work is. Separate from publishing below — a complete
                  project can stay unpublished, and an active one can be public.
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 11,
                  marginBottom: 18,
                }}
              >
                <label
                  htmlFor="vis"
                  style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: 6 }}
                >
                  Visibility
                </label>
                <select
                  id="vis"
                  className="fld"
                  value={form.visibility}
                  onChange={(e) => set("visibility")(e.target.value)}
                  style={{ maxWidth: 380 }}
                >
                  {/* 'public' is deliberately absent — the gallery is opt-in from the
                      projects list. 'internal' is offered but means BU-community
                      visible, so 'restricted' is the safe finished-but-closed choice. */}
                  <option value="hidden">{VISIBILITY_LABELS.hidden}</option>
                  <option value="restricted">{VISIBILITY_LABELS.restricted}</option>
                  <option value="internal">{VISIBILITY_LABELS.internal}</option>
                </select>
                <div style={{ fontSize: 12.5, color: "var(--ink-4)", marginTop: 4 }}>
                  The public gallery is opt-in — add it from the projects list once it
                  has screenshots and reads well.
                </div>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 14 }}
              >
                <button
                  className="btn btn-teal"
                  onClick={submit}
                  disabled={!valid || busy}
                  style={
                    !valid || busy
                      ? { opacity: 0.5, cursor: "not-allowed" }
                      : undefined
                  }
                >
                  {busy ? "Adding…" : "Add to gallery"}
                </button>
                <button className="tlink" onClick={() => setForm(BLANK)}>
                  Clear
                </button>
                {!valid && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: "var(--ink-4)",
                    }}
                  >
                    {missing.length} required field
                    {missing.length === 1 ? "" : "s"} left
                    <span
                      style={{
                        display: "block",
                        marginTop: 2,
                        color: "var(--ink-4)",
                      }}
                    >
                      missing: {missing.join(", ")}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div
            style={{
              position: "sticky",
              top: 88,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            {/* Gallery status */}
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 12 }}>
                Gallery status
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 700,
                      fontSize: 22,
                    }}
                  >
                    {total}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9.5,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "var(--ink-4)",
                      marginTop: 3,
                    }}
                  >
                    total
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 700,
                      fontSize: 22,
                      color: "var(--teal-deep)",
                    }}
                  >
                    {draftCount}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9.5,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "var(--ink-4)",
                      marginTop: 3,
                    }}
                  >
                    draft{draftCount === 1 ? "" : "s"}
                  </div>
                </div>
                {needInfoCount > 0 && (
                  <Link
                    href="/admin/projects"
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--display)",
                        fontWeight: 700,
                        fontSize: 22,
                        color: "var(--amber)",
                      }}
                    >
                      {needInfoCount}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 9.5,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "var(--amber)",
                        marginTop: 3,
                      }}
                    >
                      need info
                    </div>
                  </Link>
                )}
              </div>
            </div>

            {/* Recent projects */}
            <div className="card card-pad">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span className="sec-title" style={{ fontSize: 15 }}>
                  Recent projects
                </span>
                <Link href="/admin/projects" className="tlink">
                  Search all →
                </Link>
              </div>
              {projects.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-4)",
                    lineHeight: 1.5,
                  }}
                >
                  Nothing yet. Projects you add appear here and in the public
                  gallery for everyone.
                </div>
              ) : (
                <div>
                  {projects.slice(0, 5).map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "10px 0",
                        borderTop: "1px solid var(--line-2)",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: "var(--ink)",
                            lineHeight: 1.25,
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            flexWrap: "wrap",
                          }}
                        >
                          {p.title}
                          {p.published === false && (
                            <span className="badge b-draft">Draft</span>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10.5,
                            color: "var(--ink-4)",
                            marginTop: 3,
                          }}
                        >
                          {primaryDiscipline(p)} · {latestTerm(p)}
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                          <Link
                            href={`/admin/edit/${p.id}`}
                            className="tlink"
                          >
                            Edit →
                          </Link>
                          <button
                            onClick={() => togglePublish(p)}
                            title={
                              p.published === false
                                ? "Show in the public gallery"
                                : "Hide from the public gallery"
                            }
                            className="tlink"
                            style={{ color: "var(--ink-3)" }}
                          >
                            {p.published === false ? "Show" : "Hide"}
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => remove(p.id)}
                        title="Remove"
                        aria-label="Remove"
                        style={{
                          flexShrink: 0,
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          border: "1px solid var(--line)",
                          background: "var(--panel)",
                          color: "var(--ink-4)",
                          cursor: "pointer",
                          fontSize: 15,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {projects.length > 5 && (
                    <Link
                      href="/admin/projects"
                      className="tlink"
                      style={{
                        display: "block",
                        textAlign: "center",
                        borderTop: "1px solid var(--line-2)",
                        paddingTop: 12,
                        marginTop: 6,
                      }}
                    >
                      See all {total} projects →
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Live database note */}
            <div
              className="card card-pad"
              style={{
                background: "color-mix(in oklab, var(--teal) 7%, #fff)",
                borderColor: "color-mix(in oklab, var(--teal) 18%, #eee)",
              }}
            >
              <strong style={{ color: "var(--ink)" }}>Live database</strong>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.55,
                }}
              >
                Additions are saved to the shared Spark! database and images to
                object storage, so everything you add is visible to all visitors
                immediately.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
