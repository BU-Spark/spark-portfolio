"use client";
// Admin — edit an existing project. Prefills every field (incl. admin-only
// students/teamId per run) from GET /api/projects/[id], then PATCHes the full
// set back. Visual layer is the "Spark Control" design (PageHeader + .content +
// scoped tokens); behavior, fields, validation, and save paths are unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  SPARK_CLIENT_TYPES,
  SPARK_TERMS,
  SURFACES,
  disciplineFromCourse,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
} from "@/lib/data";
import ImageSlot from "@/components/ImageSlot";
import PdBlurbFetch from "@/components/PdBlurbFetch";
import RequestUpload from "@/components/RequestUpload";
import type { Project, Run, Contributor, ProjectContact } from "@/lib/types";
import { normalizeName } from "@/lib/gdocs";
import { semesterRank } from "@/lib/semester";
import PageHeader from "@/components/admin/PageHeader";
import ConfirmModal from "@/components/admin/ConfirmModal";
import ContactsEditor from "@/components/admin/ContactsEditor";
import { useToast } from "@/components/admin/useToast";
import { useUnsavedGuard } from "@/components/admin/useUnsavedGuard";
import { useHotkey } from "@/components/admin/useHotkey";
import { useActor, orgLabel, canEditHere } from "@/components/admin/ActorContext";

const ACCENT = "var(--teal-deep)";

// The 6 single-name team roles, edited PER-SEMESTER inside each run card.
// Emails resolve from the people directory for a mailto hint on filled roles.
const RUN_ROLES: [keyof Run, string][] = [
  ["sparkProgramLead", "Program Lead"],
  ["pm", "PM"],
  ["tpm", "TPM"],
  ["seniorAdvisor", "Senior Advisor"],
  ["techAdvisor", "Tech Advisor"],
  ["eir", "EIR"],
];

// ── Inline style helpers (the design's form primitives — .seclabel, .field,
//    .lab, .hint, .adminmark, .pdwrap, .taginput, .runcard, .toggles, .switch —
//    are not in the scoped CSS, so we mirror their spec here as inline styles). ──
const S = {
  field: { marginBottom: 18 } as React.CSSProperties,
  lab: {
    display: "block",
    fontFamily: "var(--mono)",
    fontSize: "10.5px",
    letterSpacing: ".1em",
    textTransform: "uppercase" as const,
    color: "var(--ink-4)",
    marginBottom: 7,
  } as React.CSSProperties,
  hint: {
    fontSize: 12,
    color: "var(--ink-4)",
    marginTop: 6,
    lineHeight: 1.45,
  } as React.CSSProperties,
  adminmark: {
    borderLeft: "2px solid color-mix(in oklab,var(--teal) 34%,#ccc)",
    paddingLeft: 14,
  } as React.CSSProperties,
};

// Section rule-label: "Public details · Admin-only fields · …" with an optional
// ADMIN tag and trailing rule line.
function SecLabel({
  title,
  admin = false,
  adminText = "never public",
  right,
}: {
  title: string;
  admin?: boolean;
  adminText?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "30px 0 18px",
      }}
    >
      <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
        {title}
      </span>
      {admin && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9,
            letterSpacing: ".1em",
            color: "var(--amber)",
            background: "var(--amber-bg)",
            border: "1px solid var(--amber-line)",
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          {adminText}
        </span>
      )}
      {right}
      <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
    </div>
  );
}

// Resolved image URLs come back as "/api/img/<key>" (or a full http URL for
// legacy data). ImageSlot displays those fine, but on save we must store the
// bare key again so imageUrl() doesn't double-wrap it. New uploads already hand
// back a bare key, so this is a no-op for them.
function toStoredKey(value: string): string {
  if (value.startsWith("/api/img/")) {
    return value
      .slice("/api/img/".length)
      .split("/")
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })
      .join("/");
  }
  return value;
}

// A URL field is valid when blank or a well-formed http(s) URL.
function urlOk(v: string): boolean {
  const s = v.trim();
  if (!s) return true;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface EditState {
  /** Owning team of the loaded project — decides read-only vs editable, and is
   *  only ever *changed* by a super admin (see the "Owning team" control). */
  ownerOrg: string;
  /** Pipeline state: pending | active | complete. Independent of `published`. */
  status: string;
  title: string;
  blurb: string;
  partner: string;
  contacts: ProjectContact[]; // admin-only contacts (name + email)
  clientType: string;
  repoUrl: string;
  prodUrl: string;
  clientUrl: string; // partner org's own website
  clientDesc: string; // short "about the client" blurb (public, expandable dropdown)
  codePrivate: boolean; // repo is private — show "available on request" instead of a link
  driveUrl: string; // admin-only Drive folder link
  techNote: string; // admin-only raw PD tech-stack cell
  blurbLocked: boolean; // when true, re-sync won't overwrite the blurb
  // NOTE: team roles + PD link are now PER-SEMESTER — they live on each Run
  // (form.runs[i].pm, .pdUrl, …), not at the project level.
  tech: string[];
  topics: string[];
  datasets: { label: string; url: string }[];
  images: (string | null)[]; // resolved URLs (existing) or bare keys (new uploads)
  featured: boolean;
  published: boolean;
  surfaces: string[]; // which galleries it appears on: "spark" and/or "cds"
  runs: Run[];
}

const BLANK_RUN: Run = {
  term: "",
  course: "",
  discipline: "",
  students: [],
  teamId: null,
  sparkProgramLead: null,
  pm: null,
  tpm: null,
  seniorAdvisor: null,
  techAdvisor: null,
  eir: null,
  eirIsInstructor: false,
  classInstructors: [],
  pdUrl: null,
};

// Admin-only student contributors — their own local state + Save button, since
// they live behind a separate endpoint (/api/contributors) from the project save.
type ContribRow = {
  term: string;
  firstName: string;
  lastName: string;
  githubUsername: string;
  email: string;
};
const BLANK_CONTRIB: ContribRow = {
  term: "",
  firstName: "",
  lastName: "",
  githubUsername: "",
  email: "",
};

// One editable contributor row — a Term <select> + four text cells + a remove
// button, laid out by the parent grid (its 6 children flow into the 6 columns).
function ContribRowFields({
  row,
  termOptions,
  onChange,
  onRemove,
}: {
  row: ContribRow;
  termOptions: string[];
  onChange: (patch: Partial<ContribRow>) => void;
  onRemove: () => void;
}) {
  const cellStyle: React.CSSProperties = { fontSize: 13, padding: "7px 9px" };
  const cell = (
    field: "firstName" | "lastName" | "githubUsername" | "email",
    placeholder: string
  ) => (
    <input
      className="fld"
      value={row[field]}
      onChange={(e) => onChange({ [field]: e.target.value })}
      placeholder={placeholder}
      style={cellStyle}
    />
  );
  return (
    <>
      <select
        className="fld"
        value={row.term}
        onChange={(e) => onChange({ term: e.target.value })}
        style={cellStyle}
      >
        <option value="">Term…</option>
        {/* Keep an out-of-vocab term selectable so legacy rows don't silently reset. */}
        {row.term && !termOptions.includes(row.term) && (
          <option value={row.term}>{row.term}</option>
        )}
        {termOptions.map((tm) => (
          <option key={tm} value={tm}>
            {tm}
          </option>
        ))}
      </select>
      {cell("firstName", "First")}
      {cell("lastName", "Last")}
      {cell("githubUsername", "octocat")}
      {cell("email", "name@bu.edu")}
      <button
        onClick={onRemove}
        aria-label="Remove contributor"
        title="Remove contributor"
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "var(--ink-4)",
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </>
  );
}

// TagInput: inline tag editor used for tech stack and per-run class instructors.
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
  const [focused, setFocused] = useState(false);
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 7,
        alignItems: "center",
        border: `1px solid ${focused ? "var(--teal)" : "var(--field)"}`,
        borderRadius: 10,
        padding: 8,
        background: "var(--panel)",
        minHeight: 44,
        boxShadow: focused ? "0 0 0 3px rgba(15,182,160,.12)" : undefined,
        transition: "border-color .15s, box-shadow .15s",
      }}
    >
      {value.map((tag) => (
        <span
          key={tag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--mono)",
            fontSize: "12.5px",
            background: "color-mix(in oklab,var(--teal) 12%,#fff)",
            color: "var(--teal-deep)",
            borderRadius: 7,
            padding: "4px 9px",
          }}
        >
          {tag}
          <button
            onClick={() => onChange(value.filter((x) => x !== tag))}
            style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          setFocused(false);
          add();
        }}
        placeholder={value.length ? "" : placeholder}
        style={{
          border: "none",
          outline: "none",
          flex: 1,
          minWidth: 110,
          fontSize: 14,
          padding: 4,
          background: "none",
          fontFamily: "var(--body)",
          color: "var(--ink)",
        }}
      />
    </div>
  );
}

export default function EditProjectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const actor = useActor();

  const { toastEl, notify } = useToast();

  const [form, setForm] = useState<EditState | null>(null);
  // Another team's project loads fine (reads are shared so mis-filing is visible)
  // but renders locked. The API enforces the same thing; this only avoids offering
  // an edit that would 403 on save.
  const readOnly = !!form && !canEditHere(actor, form.ownerOrg);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);
  // Pristine snapshots used for the dirty indicators.
  const baseFormRef = useRef<string | null>(null);
  const baseContribRef = useRef<string | null>(null);

  // Admin-configurable vocab (falls back to constants until /api/settings loads).
  const [clientTypes, setClientTypes] = useState<string[]>(SPARK_CLIENT_TYPES);
  const [termOptions, setTermOptions] = useState<string[]>(SPARK_TERMS);

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

  // People directory → name_key (+ aliases) → email, for the Team mailto links.
  const [peopleEmail, setPeopleEmail] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/people")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.people) return;
        const m: Record<string, string> = {};
        for (const p of d.people as {
          name: string;
          email: string | null;
          aliases?: string[];
        }[]) {
          if (!p.email) continue;
          m[normalizeName(p.name)] = p.email;
          for (const a of p.aliases ?? []) m[a] = p.email;
        }
        setPeopleEmail(m);
      })
      .catch(() => {});
  }, []);

  // Student contributors (admin-only) — own local state + own Save button.
  const [contribs, setContribs] = useState<ContribRow[]>([]);
  const [contribBusy, setContribBusy] = useState(false);

  const toRows = useCallback(
    (list: Contributor[]): ContribRow[] =>
      [...list]
        .sort((a, b) => (a.term ?? "").localeCompare(b.term ?? ""))
        .map((c) => ({
          term: c.term ?? "",
          firstName: c.firstName ?? "",
          lastName: c.lastName ?? "",
          githubUsername: c.githubUsername ?? "",
          email: c.email ?? "",
        })),
    []
  );

  useEffect(() => {
    let active = true;
    fetch(`/api/contributors?projectId=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.contributors) {
          const rows = toRows(d.contributors);
          setContribs(rows);
          baseContribRef.current = JSON.stringify(rows);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, toRows]);

  const setContrib = (i: number, patch: Partial<ContribRow>) =>
    setContribs((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    );
  const addContrib = () => setContribs((rows) => [...rows, { ...BLANK_CONTRIB }]);
  const removeContrib = (i: number) =>
    setContribs((rows) => rows.filter((_, idx) => idx !== i));

  const contribDirty = useMemo(
    () => baseContribRef.current !== null && JSON.stringify(contribs) !== baseContribRef.current,
    [contribs]
  );

  const saveContribs = async () => {
    if (readOnly) return;
    setContribBusy(true);
    try {
      const res = await fetch("/api/contributors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, contributors: contribs }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        notify("err", error || "Could not save contributors.");
        return;
      }
      const d = (await res.json()) as { contributors: Contributor[] };
      const rows = toRows(d.contributors);
      setContribs(rows);
      baseContribRef.current = JSON.stringify(rows);
      notify("ok", "Contributors saved.");
    } catch {
      notify("err", "Could not save contributors.");
    } finally {
      setContribBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch(`/api/projects/${id}`);
      if (!active) return;
      if (!res.ok) {
        setLoadError(res.status === 404 ? "Project not found." : "Could not load this project.");
        return;
      }
      const { project } = (await res.json()) as { project: Project };
      const imgs = (project.images ?? []).filter(Boolean) as string[];
      while (imgs.length < 4) imgs.push("");
      const next: EditState = {
        title: project.title ?? "",
        blurb: project.blurb ?? "",
        partner: project.partner ?? "",
        contacts: project.contacts ?? [],
        clientType: project.clientType ?? "",
        repoUrl: project.repoUrl ?? "",
        prodUrl: project.prodUrl ?? "",
        clientUrl: project.clientUrl ?? "",
        clientDesc: project.clientDesc ?? "",
        codePrivate: project.codePrivate ?? false,
        driveUrl: project.driveUrl ?? "",
        techNote: project.techNote ?? "",
        blurbLocked: !!project.blurbLocked,
        tech: project.tech ?? [],
        topics: project.topics ?? [],
        datasets: project.datasets ?? [],
        images: imgs.slice(0, 4).map((v) => v || null),
        featured: !!project.featured,
        published: project.published !== false,
        surfaces: project.surfaces?.length ? project.surfaces : ["spark"],
        ownerOrg: project.ownerOrg ?? "spark",
        status: project.status ?? "complete",
        runs: project.runs.length
          ? project.runs.map((r) => ({
              term: r.term ?? "",
              course: r.course ?? "",
              discipline: disciplineFromCourse(r.course ?? "") || (r.discipline ?? ""),
              students: r.students ?? [],
              teamId: r.teamId ?? null,
              // Per-semester team roles + PD link.
              sparkProgramLead: r.sparkProgramLead ?? null,
              pm: r.pm ?? null,
              tpm: r.tpm ?? null,
              seniorAdvisor: r.seniorAdvisor ?? null,
              techAdvisor: r.techAdvisor ?? null,
              eir: r.eir ?? null,
              eirIsInstructor: !!r.eirIsInstructor,
              classInstructors: r.classInstructors ?? [],
              pdUrl: r.pdUrl ?? null,
            }))
          : [{ ...BLANK_RUN }],
      };
      setForm(next);
      baseFormRef.current = JSON.stringify(next);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Autofocus the title ONCE, when the form first loads. `form` is a fresh object
  // on every keystroke (setForm spreads a new object), so depending on it directly
  // refocused the title after every letter — yanking the cursor out of whatever
  // field you were typing in. The ref-flag makes this fire exactly once.
  const didAutofocus = useRef(false);
  useEffect(() => {
    if (form && !didAutofocus.current) {
      didAutofocus.current = true;
      titleRef.current?.focus();
    }
  }, [form]);

  // Reflect the project title in the document title.
  useEffect(() => {
    const t = form?.title?.trim();
    document.title = t ? `Edit: ${t} — BU Spark! Admin` : "Edit project — BU Spark! Admin";
  }, [form?.title]);

  const formDirty = useMemo(
    () => !!form && baseFormRef.current !== null && JSON.stringify(form) !== baseFormRef.current,
    [form]
  );
  const isDirty = formDirty || contribDirty;
  const { guardedPush } = useUnsavedGuard(isDirty);

  const set = useCallback(
    <K extends keyof EditState>(k: K, v: EditState[K]) =>
      setForm((f) => (f ? { ...f, [k]: v } : f)),
    []
  );
  const setVal =
    (k: keyof EditState) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) =>
      setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  const setImage = (i: number) => (key: string | null) =>
    setForm((f) => {
      if (!f) return f;
      const images = [...f.images];
      images[i] = key;
      return { ...f, images };
    });

  const setRun = (i: number, patch: Partial<Run>) =>
    setForm((f) => {
      if (!f) return f;
      const runs = f.runs.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      return { ...f, runs };
    });
  // Block adding a run that duplicates an existing (term, course) pair.
  const addRun = () =>
    setForm((f) => {
      if (!f) return f;
      const dup = f.runs.some((r) => !r.term && !r.course);
      if (dup) {
        notify("err", "Finish the empty run before adding another.");
        return f;
      }
      return { ...f, runs: [...f.runs, { ...BLANK_RUN }] };
    });
  const removeRun = (i: number) =>
    setForm((f) =>
      f ? { ...f, runs: f.runs.filter((_, idx) => idx !== i) } : f
    );

  // A run is a duplicate when another run shares the same (term, course) key.
  const dupRunKeys = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<number>();
    (form?.runs ?? []).forEach((r, i) => {
      const key = `${r.term.trim().toLowerCase()}|${r.course.trim().toLowerCase()}`;
      if (!r.term.trim() || !r.course.trim()) return;
      if (seen.has(key)) {
        dups.add(i);
        dups.add(seen.get(key)!);
      } else {
        seen.set(key, i);
      }
    });
    return dups;
  }, [form?.runs]);

  // The latest run (highest semesterRank) — its PD doc is the blurb's source, and
  // its team is what the project-level views surface. -1 when there are no runs.
  const latestRunIdx = useMemo(() => {
    const runs = form?.runs ?? [];
    if (!runs.length) return -1;
    let best = 0;
    let bestRank = -1;
    runs.forEach((r, i) => {
      const rk = semesterRank(r.term);
      // Strictly greater so ties keep the FIRST run — matches rowToProject's
      // derive (stable sort, first element), so the blurb's PD source agrees.
      if (rk > bestRank) {
        bestRank = rk;
        best = i;
      }
    });
    return best;
  }, [form?.runs]);

  const save = useCallback(async () => {
    if (!form || busy) return;
    // Disabled buttons aren't the only way in: the mod+s hotkey below bypasses them
    // entirely. The server 403s either way, so this is about not firing a request
    // whose only possible outcome is a confusing error toast.
    if (readOnly) return;
    if (!form.title.trim()) {
      notify("err", "Project title is required.");
      return;
    }
    // URL validation — block save with an inline message.
    const badUrl =
      (!urlOk(form.repoUrl) && "Project URL") ||
      (!urlOk(form.prodUrl) && "Live / production URL") ||
      (!urlOk(form.clientUrl) && "Client website") ||
      (form.runs.some((r) => !urlOk(r.pdUrl ?? "")) && "PD doc link") ||
      (!urlOk(form.driveUrl) && "Drive folder link");
    if (badUrl) {
      notify("err", `${badUrl} must be a valid http(s) URL.`);
      return;
    }
    if (dupRunKeys.size) {
      notify("err", "Two runs share the same term + course. Remove the duplicate.");
      return;
    }
    const runs = form.runs
      .map((r) => ({
        term: r.term.trim(),
        course: r.course.trim(),
        discipline: disciplineFromCourse(r.course.trim()) || r.discipline || "",
        students: r.students,
        teamId: r.teamId ? String(r.teamId).trim() : null,
        // Per-semester team roles + PD link.
        sparkProgramLead: r.sparkProgramLead ?? null,
        pm: r.pm ?? null,
        tpm: r.tpm ?? null,
        seniorAdvisor: r.seniorAdvisor ?? null,
        techAdvisor: r.techAdvisor ?? null,
        eir: r.eir ?? null,
        eirIsInstructor: !!r.eirIsInstructor,
        classInstructors: r.classInstructors ?? [],
        pdUrl: r.pdUrl ? String(r.pdUrl).trim() : null,
      }))
      .filter((r) => r.term && r.course);
    if (!runs.length) {
      notify("err", "At least one run with term and course is required.");
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
      clientUrl: form.clientUrl || null,
      clientDesc: form.clientDesc || null,
      codePrivate: form.codePrivate,
      driveUrl: form.driveUrl,
      techNote: form.techNote,
      blurbLocked: form.blurbLocked,
      tech: form.tech,
      topics: form.topics,
      datasets: form.datasets.filter((d) => d.label.trim()),
      images: form.images.filter(Boolean).map((v) => toStoredKey(v as string)),
      featured: form.featured,
      published: form.published,
      surfaces: form.surfaces,
      // Sent ONLY by a super admin. For everyone else the key is absent, so the
      // route's super-only branch never even runs. The API rejects it regardless —
      // this just avoids a pointless 403 on an ordinary save.
      status: form.status,
      ...(actor?.isSuper ? { ownerOrg: form.ownerOrg } : {}),
      runs,
    };
    let res: Response;
    try {
      res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setBusy(false);
      notify("err", "Network error — changes not saved.");
      return;
    }
    setBusy(false);
    if (!res.ok) {
      const { error, warning } = await res
        .json()
        .catch(() => ({ error: "", warning: "" }));
      notify("err", error || warning || "Could not save changes.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    // Snapshot the saved state so the dirty indicator clears and the guard relaxes.
    baseFormRef.current = JSON.stringify(form);
    if (data?.warning) {
      notify("err", `Saved with a warning: ${data.warning}`);
    } else {
      notify("ok", "Changes saved.");
    }
    // Don't redirect instantly — let the toast register, then return to admin.
    setTimeout(() => router.push("/admin"), 1200);
  }, [form, busy, readOnly, dupRunKeys, id, notify, router]);

  useHotkey("mod+s", () => {
    void save();
  });

  const doDelete = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        notify("err", error || "Could not delete project.");
        setDeleting(false);
        return;
      }
      // Clear dirty state so the unsaved guard doesn't block the redirect.
      baseFormRef.current = form ? JSON.stringify(form) : null;
      baseContribRef.current = JSON.stringify(contribs);
      notify("ok", "Project deleted.");
      setTimeout(() => router.push("/admin"), 800);
    } catch {
      notify("err", "Could not delete project.");
      setDeleting(false);
    }
  };

  // Publish gate: need a blurb and at least one run with course+term
  const canPublish = !!form?.blurb?.trim() && (form?.runs ?? []).some((r) => r.term && r.course.trim());

  // Preview link to the public page; drafts get ?preview=1.
  const previewHref = form?.published ? `/projects/${id}` : `/projects/${id}?preview=1`;

  // The blurb auto-fills from the LATEST run's PD doc (per-semester PD links).
  const latestPd =
    form && latestRunIdx >= 0 ? String(form.runs[latestRunIdx]?.pdUrl ?? "") : "";
  const setLatestPd = (u: string) => {
    if (latestRunIdx >= 0) setRun(latestRunIdx, { pdUrl: u || null });
  };

  if (loadError) {
    return (
      <>
        {toastEl}
        <PageHeader eyebrow="Catalog / Edit" title="Edit project" />
        <div className="content">
          <div className="card card-pad" style={{ fontSize: 15, color: "var(--ink-3)" }}>
            {loadError}{" "}
            <Link href="/admin" style={{ color: "var(--teal-deep)" }}>
              Back to admin
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (!form) {
    return (
      <>
        {toastEl}
        <PageHeader eyebrow="Catalog / Edit" title="Edit project" />
        <div className="content">
          <div className="card card-pad">
            <div className="sk" style={{ height: 84, borderRadius: 14 }} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {toastEl}
      <ConfirmModal
        open={confirmDelete}
        title="Delete this project?"
        body={
          <>
            This permanently removes <b>{form.title || "this project"}</b> and all its
            runs. This cannot be undone.
          </>
        }
        confirmLabel="Delete project"
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <PageHeader eyebrow="Catalog / Edit" title={form.title || "Edit project"}>
        <a
          href={previewHref}
          target="_blank"
          rel="noopener noreferrer"
          className="tlink"
        >
          Preview ↗
        </a>
        <span className={`badge ${form.published ? "b-grn" : "b-draft"}`}>
          {form.published ? "Published" : "Draft"}
        </span>
        {readOnly && (
          <span className="badge" title={`Owned by ${orgLabel(form.ownerOrg)}`}>
            {orgLabel(form.ownerOrg)} — read only
          </span>
        )}
        <button
          onClick={save}
          disabled={busy || readOnly}
          className="btn btn-teal"
          title={
            readOnly
              ? `Owned by ${orgLabel(form.ownerOrg)} — ask one of their admins to edit it.`
              : undefined
          }
          style={{
            cursor: busy || readOnly ? "not-allowed" : "pointer",
            opacity: busy || readOnly ? 0.5 : 1,
          }}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </PageHeader>

      <div className="content">
        {readOnly && (
          <div
            className="card card-pad"
            style={{
              marginBottom: 16,
              borderColor: "var(--amber-line, var(--line))",
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--ink-2)",
            }}
          >
            <strong>Read-only.</strong> This project is owned by{" "}
            <strong>{orgLabel(form.ownerOrg)}</strong>, so you can see it but not
            change it — that&rsquo;s deliberate, so a mis-filed project is still
            visible to whoever would notice. Ask one of their admins, or a super
            admin if the owning team itself looks wrong.
          </div>
        )}
        <div className="card card-pad" style={{ maxWidth: 880, paddingBottom: 28 }}>
          <p className="subcopy" style={{ margin: "0 0 4px" }}>
            Update project details, manage its semester runs, and control whether
            it&apos;s published.
          </p>

          {/* ── PUBLIC DETAILS ── */}
          <SecLabel title="Public details" />

          <div style={S.field}>
            <label style={S.lab}>
              Project title <span style={{ color: "var(--teal-deep)" }}>*</span>
            </label>
            <input
              ref={titleRef}
              className="fld"
              value={form.title}
              onChange={setVal("title")}
              placeholder="e.g. Boston 311 Service Equity Dashboard"
            />
          </div>

          {/* Description + PD auto-fill */}
          <div style={S.field}>
            <label style={S.lab}>Short description</label>
            {/* PD auto-fill widget (.pdwrap inset). */}
            <div
              style={{
                background: "color-mix(in oklab,var(--teal) 5%,#fff)",
                border: "1px solid color-mix(in oklab,var(--teal) 16%,#eee)",
                borderRadius: 11,
                padding: "12px 13px",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "9.5px",
                  letterSpacing: ".1em",
                  textTransform: "uppercase" as const,
                  color: "var(--teal-deep)",
                  marginBottom: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Auto-fill from latest semester&apos;s PD doc</span>
                {latestPd.trim() && urlOk(latestPd) && (
                  <a
                    href={latestPd.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tlink"
                    style={{ fontSize: 11 }}
                  >
                    Open PD doc ↗
                  </a>
                )}
              </div>
              <PdBlurbFetch
                accent="#0a8576"
                initialUrl={latestPd}
                onUrlChange={setLatestPd}
                onFetched={(blurb, _full, tech) =>
                  setForm((f) => {
                    if (!f) return f;
                    const next = { ...f, blurb };
                    if (tech) {
                      if (tech.raw) next.techNote = tech.raw;
                      // Fill tags only when none yet — never clobber curated tech.
                      if (tech.tags.length && f.tech.length === 0)
                        next.tech = tech.tags;
                    }
                    return next;
                  })
                }
              />
            </div>
            {!urlOk(latestPd) && (
              <div style={{ ...S.hint, color: "var(--rose)" }}>
                PD doc link must be a valid http(s) URL.
              </div>
            )}
            <textarea
              className="fld"
              value={form.blurb}
              onChange={setVal("blurb")}
              placeholder="What the project does and who it helps…"
              style={{ resize: "vertical", minHeight: 72, lineHeight: 1.5 }}
            />
            <div style={S.hint}>
              One or two sentences shown on the card and detail view. The PD link
              lives per-semester under each run below; this pulls from the latest
              one. Edit after auto-fill.
            </div>
            {/* Blurb lock inline (canonical control; Visibility mirrors it read-only). */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10 }}>
              <input
                type="checkbox"
                id="blurbLocked"
                checked={form.blurbLocked}
                onChange={(e) => set("blurbLocked", e.target.checked)}
                style={{ accentColor: "var(--teal)", width: 16, height: 16, marginTop: 2, cursor: "pointer" }}
              />
              <label htmlFor="blurbLocked" style={{ cursor: "pointer" }}>
                <span style={{ fontSize: "13.5px", fontWeight: 600, display: "block" }}>Lock blurb</span>
                <span style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2, lineHeight: 1.4, display: "block" }}>
                  Keep this hand-edited blurb — a PD re-sync won&apos;t overwrite it.
                </span>
              </label>
            </div>
          </div>

          {/* Partner + client type */}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1.4fr 1fr" }}>
            <div style={S.field}>
              <label style={S.lab}>Client / partner</label>
              <input
                className="fld"
                value={form.partner}
                onChange={setVal("partner")}
                placeholder="Organization name"
              />
              <div style={S.hint}>The organization&apos;s name — e.g. City of Boston, The Boston Globe.</div>
            </div>
            <div style={S.field}>
              <label style={S.lab}>Client type</label>
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

          {/* Links */}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
            <div style={S.field}>
              <label style={S.lab}>Project URL</label>
              <input
                className="fld"
                value={form.repoUrl}
                onChange={setVal("repoUrl")}
                placeholder="https://github.com/org/repo"
                style={!urlOk(form.repoUrl) ? { borderColor: "var(--rose)" } : undefined}
              />
              {!urlOk(form.repoUrl) ? (
                <div style={{ ...S.hint, color: "var(--rose)" }}>Must be a valid http(s) URL.</div>
              ) : (
                <div style={S.hint}>
                  GitHub repo — shown as the &ldquo;View project →&rdquo; button.{" "}
                  {form.repoUrl.trim() && (
                    <a href={form.repoUrl.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-deep)", fontFamily: "var(--mono)" }}>
                      Open ↗
                    </a>
                  )}
                </div>
              )}
            </div>
            <div style={S.field}>
              <label style={S.lab}>Live / production URL</label>
              <input
                className="fld"
                value={form.prodUrl}
                onChange={setVal("prodUrl")}
                placeholder="https://example.com"
                style={!urlOk(form.prodUrl) ? { borderColor: "var(--rose)" } : undefined}
              />
              {!urlOk(form.prodUrl) ? (
                <div style={{ ...S.hint, color: "var(--rose)" }}>Must be a valid http(s) URL.</div>
              ) : (
                <div style={S.hint}>
                  Public demo or deployed site — shown publicly as &ldquo;View live →&rdquo;.{" "}
                  {form.prodUrl.trim() && (
                    <a href={form.prodUrl.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-deep)", fontFamily: "var(--mono)" }}>
                      Open ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Client website */}
          <div style={S.field}>
            <label style={S.lab}>Client website (org URL)</label>
            <input
              className="fld"
              value={form.clientUrl}
              onChange={setVal("clientUrl")}
              placeholder="https://organization.org"
              style={!urlOk(form.clientUrl) ? { borderColor: "var(--rose)" } : undefined}
            />
            {!urlOk(form.clientUrl) ? (
              <div style={{ ...S.hint, color: "var(--rose)" }}>Must be a valid http(s) URL.</div>
            ) : (
              <div style={S.hint}>
                The partner organization&apos;s own website — hyperlinked from the partner name.{" "}
                {form.clientUrl.trim() && (
                  <a href={form.clientUrl.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-deep)", fontFamily: "var(--mono)" }}>
                    Open ↗
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Client description — expandable "about the client" dropdown on the page */}
          <div style={S.field}>
            <label style={S.lab}>About the client (optional)</label>
            <textarea
              className="fld"
              value={form.clientDesc}
              onChange={setVal("clientDesc")}
              placeholder="A sentence or two about the partner organization — what they do, who they serve."
              rows={3}
              style={{ resize: "vertical" }}
            />
            <div style={S.hint}>
              Shown publicly as an expandable “About the client” dropdown under the client name. Leave blank to hide it.
            </div>
          </div>

          {/* Code is private toggle (mirrors the repo link's public treatment). */}
          <div style={{ ...S.field, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              id="codePrivate"
              checked={form.codePrivate}
              onChange={(e) => set("codePrivate", e.target.checked)}
              style={{ accentColor: "var(--teal)", width: 16, height: 16, marginTop: 2, cursor: "pointer" }}
            />
            <label htmlFor="codePrivate" style={{ cursor: "pointer" }}>
              <span style={{ fontSize: "13.5px", fontWeight: 600, display: "block" }}>Code is private</span>
              <span style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2, lineHeight: 1.4, display: "block" }}>
                Show &ldquo;available on request&rdquo; instead of a repo link.
              </span>
            </label>
          </div>

          {/* Datasets — repeatable label + url rows. */}
          <div style={S.field}>
            <label style={S.lab}>Datasets</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {form.datasets.map((d, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 30px", gap: 8, alignItems: "center" }}>
                  <input
                    className="fld"
                    value={d.label}
                    onChange={(e) =>
                      set("datasets", form.datasets.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Label"
                    style={{ fontSize: 13, padding: "7px 9px" }}
                  />
                  <input
                    className="fld"
                    value={d.url}
                    onChange={(e) =>
                      set("datasets", form.datasets.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))
                    }
                    placeholder="https://data.example.com/dataset"
                    style={{ fontSize: 13, padding: "7px 9px", ...(!urlOk(d.url) ? { borderColor: "var(--rose)" } : {}) }}
                  />
                  <button
                    onClick={() => set("datasets", form.datasets.filter((_, idx) => idx !== i))}
                    aria-label="Remove dataset"
                    title="Remove dataset"
                    style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-4)", fontSize: 16, lineHeight: 1, padding: 0 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => set("datasets", [...form.datasets, { label: "", url: "" }])}
              className="btn-sm"
              style={{ ...dashBtn, marginTop: form.datasets.length ? 10 : 0 }}
            >
              + Add dataset
            </button>
            <div style={S.hint}>Datasets used by the project — shown next to &ldquo;View project&rdquo;. Rows without a URL are dropped on save.</div>
          </div>

          {/* Tech stack */}
          <div style={S.field}>
            <label style={S.lab}>Tech stack</label>
            <TagInput
              value={form.tech}
              onChange={(v) => set("tech", v)}
              placeholder="Python, React, D3.js…"
            />
            <div style={S.hint}>Type and press Enter to add each technology.</div>
          </div>

          {/* Topics */}
          <div style={S.field}>
            <label style={S.lab}>Topics</label>
            <TagInput
              value={form.topics}
              onChange={(v) => set("topics", v)}
              placeholder="Criminal Justice, Healthcare…"
            />
            <div style={S.hint}>Subject-matter tags. Type and press Enter to add each topic.</div>
          </div>

          {/* ── ADMIN-ONLY FIELDS ── */}
          <SecLabel title="Admin-only fields" admin />

          <div style={{ ...S.field, ...S.adminmark }}>
            <label style={S.lab}>Drive folder link</label>
            <input
              className="fld"
              value={form.driveUrl}
              onChange={setVal("driveUrl")}
              placeholder="https://drive.google.com/drive/folders/…"
              style={!urlOk(form.driveUrl) ? { borderColor: "var(--rose)" } : undefined}
            />
            {!urlOk(form.driveUrl) ? (
              <div style={{ ...S.hint, color: "var(--rose)" }}>Must be a valid http(s) URL.</div>
            ) : form.driveUrl.trim() ? (
              <div style={S.hint}>
                <a
                  href={form.driveUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--teal-deep)", fontFamily: "var(--mono)" }}
                >
                  Open Drive folder ↗
                </a>
                <span style={{ color: "var(--ink-4)" }}> — saved with the project (admin-only).</span>
              </div>
            ) : (
              <div style={S.hint}>Google Drive folder for this project (admin-only).</div>
            )}
          </div>

          <div style={{ ...S.field, ...S.adminmark }}>
            <label style={S.lab}>Contacts (internal)</label>
            <ContactsEditor
              value={form.contacts}
              onChange={(v) => set("contacts", v)}
            />
            <div style={S.hint}>Contact people for this project (name + email) — admin-only, never shown publicly. Add as many as needed.</div>
          </div>

          <div style={{ ...S.field, ...S.adminmark }}>
            <label style={S.lab}>Tech-stack note (internal)</label>
            <textarea
              className="fld"
              value={form.techNote}
              onChange={setVal("techNote")}
              placeholder="e.g. Client prefers R but okay with Python…"
              style={{ minHeight: 60, resize: "vertical", lineHeight: 1.5 }}
            />
            <div style={S.hint}>Raw &ldquo;Tech Stack&rdquo; cell from the PD — admin-only, never shown publicly. Auto-filled on fetch; use it to curate the public tags above.</div>
          </div>

          {/* Student contributors (own state + separate Save → PUT /api/contributors). */}
          <div style={{ ...S.field, ...S.adminmark }}>
            <label style={S.lab}>Student contributors (internal)</label>
            <div style={{ ...S.hint, marginTop: 0, marginBottom: 10 }}>
              Students are admin-only — never shown publicly. A project&apos;s team can differ per semester (set Term).
            </div>
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                background: "var(--panel-2)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1.1fr 1.3fr 30px",
                  gap: 8,
                  alignItems: "center",
                  padding: "9px 12px",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: ".06em",
                  textTransform: "uppercase" as const,
                  color: "var(--ink-4)",
                  background: "#f1f3f0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <span>Term</span>
                <span>First</span>
                <span>Last</span>
                <span>GitHub</span>
                <span>BU email</span>
                <span />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1.1fr 1.3fr 30px",
                  gap: 8,
                  alignItems: "center",
                  padding: contribs.length ? "10px 12px" : 0,
                }}
              >
                {contribs.map((row, i) => (
                  <ContribRowFields
                    key={i}
                    row={row}
                    termOptions={termOptions}
                    onChange={(patch) => setContrib(i, patch)}
                    onRemove={() => removeContrib(i)}
                  />
                ))}
              </div>
              {contribs.length === 0 && (
                <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--ink-4)" }}>
                  No contributors yet.
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={addContrib} className="btn-sm" style={dashBtn}>
                + Add contributor
              </button>
              <button
                onClick={saveContribs}
                disabled={contribBusy || !contribDirty}
                className="btn-sm"
                style={{
                  color: "var(--teal-deep)",
                  borderColor: "var(--teal)",
                  opacity: contribBusy || !contribDirty ? 0.6 : 1,
                  cursor: contribBusy || !contribDirty ? "not-allowed" : "pointer",
                }}
              >
                {contribBusy ? "Saving…" : "Save contributors"}
              </button>
              {contribDirty && (
                <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--amber)" }}>
                  Unsaved contributor edits — save them separately or with the bar below.
                </span>
              )}
            </div>
          </div>

          {/* ── IMAGES ── */}
          <SecLabel title="Images" />
          <div style={S.field}>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 8 }}>
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
            <div style={S.hint}>
              Drag an image onto each slot (or click to browse). The first is the cover; up to four show in the detail view.
            </div>
          </div>
          <RequestUpload projectId={id} />

          {/* ── SEMESTER RUNS ── */}
          <SecLabel title={`Semester runs (${form.runs.length})`} />
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {form.runs.map((run, i) => {
              const known = disciplineFromCourse(run.course);
              const isDup = dupRunKeys.has(i);
              return (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${isDup ? "var(--rose)" : "var(--line)"}`,
                    borderRadius: 14,
                    background: "var(--panel-2)",
                    padding: "16px 18px",
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, textTransform: "uppercase" as const, color: "var(--ink-4)" }}>
                      Run {i + 1}
                    </span>
                    {run.term && run.course && (
                      <span style={{ fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--ink-3)" }}>
                        {run.term} — {run.course}
                      </span>
                    )}
                    {isDup && (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--rose)" }}>
                        duplicate term + course
                      </span>
                    )}
                    {form.runs.length > 1 && (
                      <button
                        onClick={() => removeRun(i)}
                        className="tlink"
                        style={{ color: "var(--rose)", marginLeft: "auto" }}
                      >
                        Remove run
                      </button>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1.4fr", marginBottom: 14 }}>
                    <div>
                      <label style={S.lab}>Term <span style={{ color: "var(--teal-deep)" }}>*</span></label>
                      <select
                        className="fld"
                        value={run.term}
                        onChange={(e) => setRun(i, { term: e.target.value })}
                      >
                        <option value="">Select…</option>
                        {run.term && !termOptions.includes(run.term) && (
                          <option value={run.term}>{run.term}</option>
                        )}
                        {termOptions.map((tm) => (
                          <option key={tm} value={tm}>
                            {tm}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={S.lab}>Course <span style={{ color: "var(--teal-deep)" }}>*</span></label>
                      <input
                        className="fld"
                        value={run.course}
                        onChange={(e) => {
                          const course = e.target.value;
                          const auto = disciplineFromCourse(course);
                          setRun(i, { course, discipline: auto || run.discipline });
                        }}
                        placeholder="e.g. DS488, DS519, DS539, DS549, DS594, CS506, XC475…"
                      />
                      {run.course && (
                        <div style={S.hint}>
                          Discipline:{" "}
                          <b>{known || "unknown — set it manually below"}</b>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Discipline override — shown when the course doesn't auto-map. */}
                  {run.course.trim() && !known && (
                    <div style={{ marginBottom: 14 }}>
                      <label style={S.lab}>Discipline (manual)</label>
                      <input
                        className="fld"
                        value={run.discipline}
                        onChange={(e) => setRun(i, { discipline: e.target.value })}
                        placeholder="e.g. Data Visualization, Software Engineering"
                      />
                      <div style={S.hint}>This course isn&apos;t in the course→discipline map; set the discipline here and it saves with the run.</div>
                    </div>
                  )}

                  {/* Per-semester team + PD link — collapsed by default so the
                      run list stays scannable. Everything admin-only here. */}
                  <details style={{ ...S.adminmark, marginBottom: 0 }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        fontFamily: "var(--mono)",
                        fontSize: 12,
                        color: "var(--ink-3)",
                        userSelect: "none",
                        padding: "2px 0",
                      }}
                    >
                      Team &amp; PD for this semester{" "}
                      <span style={{ color: "var(--ink-4)" }}>(internal · never public)</span>
                    </summary>
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <label style={S.lab}>PD doc link</label>
                        <input
                          className="fld"
                          value={run.pdUrl ?? ""}
                          onChange={(e) => setRun(i, { pdUrl: e.target.value || null })}
                          placeholder="https://docs.google.com/document/…"
                          style={!urlOk(run.pdUrl ?? "") ? { borderColor: "var(--rose)" } : undefined}
                        />
                        <div style={S.hint}>
                          Project Description doc for this semester. The latest run&apos;s PD feeds the blurb auto-fill above.
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 18px" }}>
                        {RUN_ROLES.map(([key, label]) => {
                          const val = String(run[key] ?? "");
                          const email = val ? peopleEmail[normalizeName(val)] : undefined;
                          return (
                            <div key={key}>
                              <label style={S.lab}>{label}</label>
                              <input
                                className="fld"
                                value={val}
                                onChange={(e) =>
                                  setRun(i, { [key]: e.target.value || null } as Partial<Run>)
                                }
                                placeholder={key === "tpm" ? 'Name — if none, "N/A"' : "Name"}
                              />
                              {val && email && (
                                <div style={S.hint}>
                                  <a href={`mailto:${email}`} style={{ color: "var(--teal-deep)" }}>✉ {email}</a>
                                </div>
                              )}
                              {key === "eir" && (
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    marginTop: 6,
                                    fontFamily: "var(--mono)",
                                    fontSize: 11,
                                    color: "var(--ink-3)",
                                    cursor: "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!run.eirIsInstructor}
                                    onChange={(e) => setRun(i, { eirIsInstructor: e.target.checked })}
                                    style={{ accentColor: "var(--teal)" }}
                                  />
                                  EIR is actually a class instructor
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div>
                        <label style={S.lab}>Class Instructor(s)</label>
                        <TagInput
                          value={run.classInstructors ?? []}
                          onChange={(v) => setRun(i, { classInstructors: v })}
                          placeholder="Instructor name…"
                        />
                        <div style={S.hint}>Type and press Enter to add each instructor. Multiple allowed.</div>
                      </div>

                      <div>
                        <label style={S.lab}>Team ID</label>
                        <input
                          className="fld"
                          value={run.teamId ?? ""}
                          onChange={(e) => setRun(i, { teamId: e.target.value || null })}
                          placeholder="e.g. fa25-projecta"
                        />
                        <div style={S.hint}>Airtable team identifier — admin reference only.</div>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>

          <button onClick={addRun} className="btn-sm" style={dashBtn}>
            + Add run
          </button>

          {/* ── VISIBILITY ── */}
          <SecLabel title="Visibility" />
          <div
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: "16px 18px",
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 16,
            }}
          >
            {/* Featured */}
            <ToggleSwitch
              id="feat"
              checked={form.featured}
              onChange={(v) => set("featured", v)}
              title="Featured"
              sub="Spotlighted on the gallery."
            />
            {/* Published (gated) */}
            <ToggleSwitch
              id="published"
              checked={form.published}
              disabled={!canPublish && !form.published}
              onChange={(v) => set("published", v)}
              title="Published"
              sub={
                !canPublish && !form.published ? (
                  <>
                    Not ready to publish — still missing:
                    <ul style={{ margin: "4px 0 0 14px", padding: 0 }}>
                      {!form.blurb.trim() && <li>Description (blurb)</li>}
                      {!form.runs.some((r) => r.term && r.course.trim()) && <li>At least one course run</li>}
                    </ul>
                  </>
                ) : (
                  "Unpublish to hide from the public gallery (draft)."
                )
              }
            />
            {/* Lock blurb (mirrors Description's canonical control). */}
            <ToggleSwitch
              id="lock2"
              checked={form.blurbLocked}
              onChange={(v) => set("blurbLocked", v)}
              title="Lock blurb"
              sub={
                form.blurbLocked
                  ? "A PD re-sync won't overwrite it. (Mirrors the control in Public details.)"
                  : "A PD re-sync may overwrite the blurb. Lock it to protect it."
              }
            />
          </div>

          {/* Pipeline status — the THIRD axis. Deliberately separate from the publish
              toggle: a project can be complete but unpublished (finished, waiting on
              a screenshot), or published while still active. Any admin who may edit
              the project may move it — this is not an authority decision. */}
          <div style={{ ...S.field, marginTop: 22 }}>
            <label style={S.lab}>Project status</label>
            <select
              className="fld"
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              disabled={readOnly}
              style={{ maxWidth: 320 }}
            >
              {PROJECT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {PROJECT_STATUS_LABELS[st]}
                </option>
              ))}
            </select>
            <div style={S.hint}>
              Where the work is, not who can see it. Publishing is controlled
              separately below.
            </div>
          </div>

          {/* Owning team — AUTHORITY, distinct from the galleries control below.
              Only a super admin can move a project between teams; everyone else
              sees a static badge so it's obvious who to ask. */}
          <div style={{ ...S.field, marginTop: 22 }}>
            <label style={S.lab}>Owning team</label>
            {actor?.isSuper ? (
              <>
                <select
                  className="fld"
                  value={form.ownerOrg}
                  onChange={(e) => set("ownerOrg", e.target.value)}
                  style={{ maxWidth: 260 }}
                >
                  <option value="spark">Spark!</option>
                  <option value="cds">CDS</option>
                </select>
                <div style={S.hint}>
                  Which team&rsquo;s admins may edit this project. Moving it also
                  removes it from the other team&rsquo;s PD sync.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)" }}>
                  {orgLabel(form.ownerOrg)}
                </div>
                <div style={S.hint}>
                  Only a super admin can move a project to another team.
                </div>
              </>
            )}
          </div>

          {/* Surfaces — which public galleries this project appears on. This is
              VISIBILITY only: tagging the other gallery grants that team no edit
              rights, which is why it isn't restricted to super admins. */}
          <div style={{ ...S.field, marginTop: 22 }}>
            <label style={S.lab}>Show on galleries</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
              {SURFACES.map((s) => {
                const on = form.surfaces.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() =>
                      set(
                        "surfaces",
                        // never allow zero surfaces — keep at least the last one
                        on
                          ? form.surfaces.length > 1
                            ? form.surfaces.filter((x) => x !== s.key)
                            : form.surfaces
                          : [...form.surfaces, s.key],
                      )
                    }
                    title={s.hint}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 14px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 13.5,
                      fontWeight: 600,
                      border: on ? "1px solid var(--teal)" : "1px solid var(--line)",
                      background: on ? "color-mix(in oklab, var(--teal) 10%, var(--panel))" : "var(--panel)",
                      color: on ? "var(--teal-deep)" : "var(--sec)",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 15,
                        height: 15,
                        borderRadius: 4,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 10,
                        color: "#fff",
                        border: on ? "1px solid var(--teal)" : "1px solid var(--ink-4)",
                        background: on ? "var(--teal)" : "transparent",
                      }}
                    >
                      {on ? "✓" : ""}
                    </span>
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div style={S.hint}>
              Which public galleries show this project. Tag it for Spark!, CDS, or both. At least one is required.
            </div>
          </div>

          {/* Danger zone — delete the project. Hidden outright when read-only:
              a destructive control that always fails is worse than no control. */}
          <div
            style={{
              ...S.field,
              ...S.adminmark,
              marginTop: 22,
              display: readOnly ? "none" : undefined,
            }}
          >
            <label style={S.lab}>Danger zone</label>
            <button
              type="button"
              className="btn-sm"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              style={{
                color: "var(--rose)",
                borderColor: "var(--rose-line)",
                background: "var(--panel)",
                cursor: deleting ? "not-allowed" : "pointer",
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? "Deleting…" : "Delete project"}
            </button>
            <div style={S.hint}>Permanently removes this project and all its runs. Cannot be undone.</div>
          </div>

          {/* Save bar. */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 26, flexWrap: "wrap" }}>
            <button
              onClick={save}
              disabled={busy || readOnly}
              className="btn btn-teal"
              style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => guardedPush("/admin")}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <span style={{ flex: 1 }} />
            {isDirty ? (
              <span style={{ color: "var(--amber)", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 12 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)", display: "inline-block" }} />
                Unsaved changes {contribDirty ? "(incl. contributors)" : ""}
              </span>
            ) : (
              <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 12 }}>All changes saved</span>
            )}
            <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 12 }}>⌘S to save</span>
          </div>
        </div>
      </div>
    </>
  );
}

// Dashed "+ Add" button used for contributors and runs (matches design's .dashbtn).
const dashBtn: React.CSSProperties = {
  border: "1px dashed color-mix(in oklab,var(--teal) 50%,#ccc)",
  background: "color-mix(in oklab,var(--teal) 6%,#fff)",
  color: "var(--teal-deep)",
  fontFamily: "var(--mono)",
  fontSize: "12.5px",
  fontWeight: 600,
  borderRadius: 9,
  padding: "9px 14px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// One Visibility toggle — checkbox + label/sub, per the design's .tog/.switch group.
function ToggleSwitch({
  id,
  checked,
  disabled = false,
  onChange,
  title,
  sub,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  title: string;
  sub: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          accentColor: "var(--teal)",
          marginTop: 2,
          width: 16,
          height: 16,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      />
      <label htmlFor={id} style={{ cursor: disabled ? "not-allowed" : "pointer" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
      </label>
    </div>
  );
}
