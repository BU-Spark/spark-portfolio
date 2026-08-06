"use client";
// Searchable admin project manager. The dashboard sidebar only shows a handful
// of recent projects; this is the full list with a search box and Published /
// Drafts filters so an admin can quickly find a project to edit, hide, or remove.
// Reuses the same endpoints as the dashboard (GET /api/projects, PATCH/DELETE
// /api/projects/[id]).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  primaryDiscipline,
  latestTerm,
  projectTerms,
  projectCourses,
  missingInfo,
  missingTeam,
  reviewFlags,
  publishBlockers,
} from "@/lib/project";
import { disciplineColor, DISCIPLINE_ABBR } from "@/lib/colors";
import type { Project } from "@/lib/types";
import { normalizeName } from "@/lib/gdocs";
import PageHeader from "@/components/admin/PageHeader";
import { useActor, orgLabel, canEditHere } from "@/components/admin/ActorContext";
import { useToast } from "@/components/admin/useToast";
import ConfirmModal from "@/components/admin/ConfirmModal";
import MergeProjectsModal from "@/components/admin/MergeProjectsModal";
import FilterBar from "@/components/admin/FilterBar";
import { useHotkey } from "@/components/admin/useHotkey";

// Short uppercase code shown on the discipline cover tile (e.g. DATAVIZ, ML).
function disciplineAbbr(d: string): string {
  return DISCIPLINE_ABBR[d] || (d || "MISC").slice(0, 4).toUpperCase();
}

// The three public-facing fields surfaced as completeness pips on each card.
// Maps missingInfo() labels → short pip captions.
const PIP_FIELDS = [
  { key: "Description", label: "Desc" },
  { key: "Images", label: "Images" },
  { key: "GitHub repo", label: "Repo" },
] as const;

type Tab = "all" | "published" | "drafts" | "needsInfo";

// Gap chips offered in the FilterBar (Course added per audit).
const GAP_FIELDS = ["Course", "Tech stack", "GitHub repo", "Description", "Images", "Contributors"] as const;

// Compact pill label for each missingInfo() field shown next to a row title.
const MISSING_PILL: Record<string, string> = {
  Course: "no course",
  "Tech stack": "no tech",
  "GitHub repo": "no repo",
  Description: "no description",
  Images: "no images",
  Contributors: "no contributors",
};

// Foreign-team rows stay VISIBLE (with their actions disabled) rather than being
// filtered out. That's deliberate: a project mis-filed to the wrong team would
// otherwise be invisible to exactly the people who'd recognise the mistake, and
// both teams would go on to create duplicates — which is the super-admin traffic
// this whole feature is meant to avoid.
export default function ManageProjectsPage() {
  const actor = useActor();
  const router = useRouter();
  const { toastEl, notify } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState<string | null>(null);
  // Curated people directory → resolve a stored role name to its canonical person
  // (so the filter is robust to name variants like "Abby" vs "Abby Gualda").
  const [people, setPeople] = useState<{ name: string; aliases: string[] }[]>([]);
  const [leadFilter, setLeadFilter] = useState("");
  const [pmFilter, setPmFilter] = useState("");
  const [tpmFilter, setTpmFilter] = useState("");
  const [termFilter, setTermFilter] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState("");
  const [gapIncludes, setGapIncludes] = useState<Set<string>>(new Set());
  const [gapExcludes, setGapExcludes] = useState<Set<string>>(new Set());
  // How multiple "missing X" (include) chips combine: "all" = AND (missing every
  // selected field), "any" = OR (missing at least one). Excludes always AND.
  const [gapMode, setGapMode] = useState<"all" | "any">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [confirmPublishAll, setConfirmPublishAll] = useState(false);
  // Single-row destructive confirm targets.
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [hideTarget, setHideTarget] = useState<Project | null>(null);
  // Bulk destructive confirms.
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Which row's overflow (⋯) menu is open, if any.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        notify("err", "Couldn't load projects. Please retry.");
        return;
      }
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      notify("err", "Couldn't load projects — network error.");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    fetch("/api/people")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.people) setPeople(d.people);
      })
      .catch(() => {});
  }, []);

  // Read ?tab= and ?gap= deep-links from the dashboard once on mount. Reading
  // window.location directly avoids needing a useSearchParams Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "all" || t === "published" || t === "drafts" || t === "needsInfo") {
      setTab(t);
    }
    const g = params.get("gap");
    if (g) {
      const wanted = GAP_FIELDS.find((f) => f === g || normalizeName(f) === normalizeName(g));
      if (wanted) setGapIncludes(new Set([wanted]));
    }
  }, []);

  // name_key (+ aliases) → canonical name; canonical(raw) resolves a stored value.
  const keyToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) {
      m.set(normalizeName(p.name), p.name);
      for (const a of p.aliases ?? []) m.set(a, p.name);
    }
    return m;
  }, [people]);
  const canonical = useCallback(
    (raw?: string | null) => {
      const v = (raw ?? "").trim();
      if (!v) return "";
      return keyToName.get(normalizeName(v)) ?? v;
    },
    [keyToName]
  );
  const roleOptions = useCallback(
    (field: "sparkProgramLead" | "pm" | "tpm") => {
      const s = new Set<string>();
      for (const p of projects) {
        const c = canonical(p[field]);
        if (c) s.add(c);
      }
      return [...s].sort();
    },
    [projects, canonical]
  );

  // Term + discipline option lists (from project runs).
  const termOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of projects) for (const t of projectTerms(p)) if (t) s.add(t);
    return [...s].sort();
  }, [projects]);
  const disciplineOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of projects) for (const r of p.runs) if (r.discipline) s.add(r.discipline);
    return [...s].sort();
  }, [projects]);

  const mine = (p: Project) => canEditHere(actor, p.ownerOrg ?? "spark");
  const lockedTitle = (p: Project) =>
    `Owned by ${orgLabel(p.ownerOrg ?? "spark")} — ask one of their admins to change it.`;

  const togglePublish = async (p: Project) => {
    const nextPublished = p.published === false;
    setBusy(p.id);
    const res = await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: nextPublished }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const msg = res && res.status === 422
        ? `Can't publish "${p.title}": missing ${publishBlockers(p).join(", ")}.`
        : `Couldn't update "${p.title}".`;
      notify("err", msg);
      setBusy(null);
      return;
    }
    notify("ok", nextPublished ? `"${p.title}" is now visible.` : `"${p.title}" hidden.`);
    await refresh();
    setBusy(null);
  };

  // "Show" (publish) respects the publish gate; route to togglePublish which
  // surfaces a 422. "Hide" on a published project asks for confirmation first.
  const onToggleClick = (p: Project) => {
    if (p.published === false) {
      togglePublish(p);
    } else {
      setHideTarget(p);
    }
  };

  const toggleFeatured = async (p: Project) => {
    const next = !p.featured;
    setBusy(p.id);
    const res = await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured: next }),
    }).catch(() => null);
    if (!res || !res.ok) {
      notify("err", `Couldn't update "${p.title}".`);
      setBusy(null);
      return;
    }
    notify("ok", next ? `"${p.title}" featured.` : `"${p.title}" unfeatured.`);
    await refresh();
    setBusy(null);
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedProjects = useMemo(
    () => projects.filter((p) => selectedIds.has(p.id)),
    [projects, selectedIds]
  );

  const batchPublish = async () => {
    const ids = selectedProjects.filter((p) => p.published === false).map((p) => p.id);
    if (!ids.length) return;
    setBatchBusy(true);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ published: true }),
        })
          .then((r) => ({ id, ok: r.ok }))
          .catch(() => ({ id, ok: false }))
      )
    );
    const failed = results.filter((r) => !r.ok).length;
    const succeeded = results.length - failed;
    setSelectedIds(new Set());
    setBatchBusy(false);
    notify(
      failed ? "err" : "ok",
      failed
        ? `${succeeded} published, ${failed} failed (missing blurb or course run).`
        : `${succeeded} project${succeeded !== 1 ? "s" : ""} published.`
    );
    await refresh();
  };

  const batchHide = async () => {
    const ids = selectedProjects.filter((p) => p.published !== false).map((p) => p.id);
    if (!ids.length) return;
    setBatchBusy(true);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ published: false }),
        })
          .then((r) => ({ id, ok: r.ok }))
          .catch(() => ({ id, ok: false }))
      )
    );
    const failed = results.filter((r) => !r.ok).length;
    const succeeded = results.length - failed;
    setSelectedIds(new Set());
    setBatchBusy(false);
    notify(
      failed ? "err" : "ok",
      failed ? `${succeeded} hidden, ${failed} failed.` : `${succeeded} project${succeeded !== 1 ? "s" : ""} hidden.`
    );
    await refresh();
  };

  const batchDeleteConfirmed = async () => {
    setConfirmBulkDelete(false);
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBatchBusy(true);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/projects/${id}`, { method: "DELETE" })
          .then((r) => ({ id, ok: r.ok }))
          .catch(() => ({ id, ok: false }))
      )
    );
    const failed = results.filter((r) => !r.ok).length;
    const succeeded = results.length - failed;
    setSelectedIds(new Set());
    setBatchBusy(false);
    notify(
      failed ? "err" : "ok",
      failed ? `${succeeded} removed, ${failed} failed.` : `${succeeded} project${succeeded !== 1 ? "s" : ""} removed.`
    );
    await refresh();
  };

  const removeConfirmed = async () => {
    const p = removeTarget;
    setRemoveTarget(null);
    if (!p) return;
    setBusy(p.id);
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      notify("err", `Couldn't remove "${p.title}".`);
      setBusy(null);
      return;
    }
    notify("ok", `"${p.title}" removed.`);
    await refresh();
    setBusy(null);
  };

  const hideConfirmed = async () => {
    const p = hideTarget;
    setHideTarget(null);
    if (!p) return;
    await togglePublish(p);
  };

  // Close the overflow menu on any outside click / Escape.
  useEffect(() => {
    if (!openMenuId) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".rec-menu-wrap")) setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  // ⋯ menu: copy the project's public gallery link to the clipboard.
  const copyPublicLink = async (p: Project) => {
    const url = `${window.location.origin}/projects/${p.id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("ok", "Public link copied.");
    } catch {
      notify("err", url);
    }
    setOpenMenuId(null);
  };

  // ⋯ menu: open the public gallery page in a new tab.
  const viewInGallery = (p: Project) => {
    window.open(`/projects/${p.id}`, "_blank", "noopener,noreferrer");
    setOpenMenuId(null);
  };

  const hasActiveFilters =
    !!query.trim() ||
    !!leadFilter ||
    !!pmFilter ||
    !!tpmFilter ||
    !!termFilter ||
    !!disciplineFilter ||
    tab !== "all" ||
    gapIncludes.size > 0 ||
    gapExcludes.size > 0;

  const clearFilters = () => {
    setQuery("");
    setTab("all");
    setLeadFilter("");
    setPmFilter("");
    setTpmFilter("");
    setTermFilter("");
    setDisciplineFilter("");
    setGapIncludes(new Set());
    setGapExcludes(new Set());
    setGapMode("all");
  };

  // The all/any toggle only matters with 2+ required gaps; reset to "all" below
  // that so re-adding a chip starts from a predictable default (no hidden "any").
  useEffect(() => {
    if (gapIncludes.size <= 1) setGapMode("all");
  }, [gapIncludes]);

  // Active count for the FilterBar pill (search excluded — it has its own box).
  const activeFilterCount =
    (leadFilter ? 1 : 0) +
    (pmFilter ? 1 : 0) +
    (tpmFilter ? 1 : 0) +
    (termFilter ? 1 : 0) +
    (disciplineFilter ? 1 : 0) +
    gapIncludes.size +
    gapExcludes.size;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (tab === "published" && p.published === false) return false;
      if (tab === "drafts" && p.published !== false) return false;
      if (tab === "needsInfo" && missingInfo(p).length === 0) return false;
      if (leadFilter && canonical(p.sparkProgramLead) !== leadFilter) return false;
      if (pmFilter && canonical(p.pm) !== pmFilter) return false;
      if (tpmFilter && canonical(p.tpm) !== tpmFilter) return false;
      if (termFilter && !projectTerms(p).includes(termFilter)) return false;
      if (disciplineFilter && !p.runs.some((r) => r.discipline === disciplineFilter)) return false;
      const missing = missingInfo(p);
      if (gapIncludes.size) {
        const inc = [...gapIncludes];
        const ok =
          gapMode === "any"
            ? inc.some((g) => missing.includes(g))
            : inc.every((g) => missing.includes(g));
        if (!ok) return false;
      }
      for (const g of gapExcludes) {
        if (missing.includes(g)) return false;
      }
      if (!q) return true;
      const hay = [
        p.title,
        p.partner,
        p.clientType,
        ...projectCourses(p),
        ...projectTerms(p),
        ...p.runs.map((r) => r.discipline),
        p.sparkProgramLead ?? "",
        p.pm ?? "",
        p.tpm ?? "",
        p.seniorAdvisor ?? "",
        p.techAdvisor ?? "",
        p.eir ?? "",
        ...(p.classInstructors ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    projects,
    query,
    tab,
    leadFilter,
    pmFilter,
    tpmFilter,
    termFilter,
    disciplineFilter,
    gapIncludes,
    gapExcludes,
    gapMode,
    canonical,
  ]);

  const draftCount = projects.filter((p) => p.published === false).length;
  const needsInfoCount = projects.filter((p) => missingInfo(p).length > 0).length;

  // Drafts in the current filtered view — drives "Select all N drafts".
  const filteredDrafts = useMemo(
    () => filtered.filter((p) => p.published === false),
    [filtered]
  );
  const allFilteredDraftsSelected =
    filteredDrafts.length > 0 && filteredDrafts.every((p) => selectedIds.has(p.id));

  const selectAllFilteredDrafts = () => {
    if (allFilteredDraftsSelected) {
      setSelectedIds((s) => {
        const next = new Set(s);
        for (const p of filteredDrafts) next.delete(p.id);
        return next;
      });
    } else {
      setSelectedIds((s) => {
        const next = new Set(s);
        for (const p of filteredDrafts) next.add(p.id);
        return next;
      });
    }
  };

  const draftProjects = useMemo(
    () => projects.filter((p) => p.published === false),
    [projects]
  );
  const readyDraftProjects = useMemo(
    () => draftProjects.filter((p) => publishBlockers(p).length === 0),
    [draftProjects]
  );

  // Counts of selected projects by current published state — drives which bulk
  // actions are offered.
  const selectedDraftCount = selectedProjects.filter((p) => p.published === false).length;
  const selectedPublishedCount = selectedProjects.filter((p) => p.published !== false).length;

  const publishAllReadyConfirmed = async () => {
    setConfirmPublishAll(false);
    if (!readyDraftProjects.length) return;
    setDiagnoseBusy(true);
    const results = await Promise.all(
      readyDraftProjects.map((p) =>
        fetch(`/api/projects/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ published: true }),
        })
          .then((r) => ({ id: p.id, ok: r.ok }))
          .catch(() => ({ id: p.id, ok: false }))
      )
    );
    const failed = results.filter((r) => !r.ok).length;
    const succeeded = results.length - failed;
    setDiagnoseBusy(false);
    setDiagnosing(false);
    notify(
      failed ? "err" : "ok",
      failed
        ? `${succeeded} published, ${failed} failed.`
        : `${succeeded} draft${succeeded !== 1 ? "s" : ""} published.`
    );
    await refresh();
  };

  // Hotkeys: Escape clears search (or closes Diagnose); "d" toggles Diagnose.
  useHotkey("escape", () => {
    if (diagnosing) setDiagnosing(false);
    else if (query) setQuery("");
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "d") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (draftCount === 0) return;
      e.preventDefault();
      setDiagnosing((d) => !d);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [draftCount]);

  return (
    <>
      {toastEl}

      <PageHeader eyebrow="Catalog" title="Projects">
        <div className="search" style={{ maxWidth: "34vw" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4-4" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, client, discipline, course, term…"
            autoFocus
          />
        </div>
        <Link className="btn btn-teal" href="/admin/new" style={{ textDecoration: "none" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add a project
        </Link>
      </PageHeader>

      <div className="content">
        <p className="subcopy" style={{ margin: "0 0 20px" }}>
          Search the full catalog to edit, hide, or remove any project.
        </p>

        {/* Status segmented control + diagnose toggle */}
        <div className="segwrap" style={{ marginBottom: 14 }}>
          <div className="tabs">
            {([
              ["all", "All", projects.length],
              ["published", "Published", projects.length - draftCount],
              ["drafts", "Drafts", draftCount],
              ["needsInfo", "Needs info", needsInfoCount],
            ] as [Tab, string, number][]).map(([key, label, count]) => {
              const on = tab === key;
              const needs = key === "needsInfo";
              return (
                <button
                  key={key}
                  className={`tab${on ? " on" : ""}`}
                  onClick={() => setTab(key)}
                  style={
                    on && needs
                      ? { background: "var(--amber)", color: "#fff", borderColor: "transparent" }
                      : undefined
                  }
                >
                  {label} <span className="c">{count}</span>
                </button>
              );
            })}
          </div>
          {draftCount > 0 && (
            <button
              className="btn-sm"
              onClick={() => setDiagnosing((d) => !d)}
              title="Toggle the draft diagnosis panel (d)"
              style={
                diagnosing
                  ? { background: "var(--teal)", color: "#042a25", borderColor: "transparent", whiteSpace: "nowrap" }
                  : { whiteSpace: "nowrap" }
              }
            >
              {diagnosing ? "Close diagnose" : `Diagnose drafts (${draftCount})`}
            </button>
          )}
        </div>

        {/* Collapsible filters */}
        <FilterBar activeCount={activeFilterCount}>
          <div className="filterpanel">
            {/* Dropdown filters — labeled grid */}
            <div className="filtergrid">
              <div className="filteritem">
                <label className="lab">Term</label>
                <select className="fld" value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
                  <option value="">Any term</option>
                  {termOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="filteritem">
                <label className="lab">Discipline</label>
                <select className="fld" value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)}>
                  <option value="">Any discipline</option>
                  {disciplineOptions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              {(
                [
                  ["Program Lead", leadFilter, setLeadFilter, "sparkProgramLead"],
                  ["PM", pmFilter, setPmFilter, "pm"],
                  ["TPM", tpmFilter, setTpmFilter, "tpm"],
                ] as [string, string, (v: string) => void, "sparkProgramLead" | "pm" | "tpm"][]
              ).map(([label, value, setter, field]) => (
                <div key={field} className="filteritem">
                  <label className="lab">{label}</label>
                  <select className="fld" value={value} onChange={(e) => setter(e.target.value)}>
                    <option value="">Anyone</option>
                    {roleOptions(field).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Gaps — tri-state chips + AND/OR mode toggle */}
            <div className="gapsblock">
              <div className="gapshead">
                <div>
                  <span className="gapstitle">Missing info</span>
                  <span className="gapshint">
                    Click a chip to <b style={{ color: "#15803d" }}>require</b> that gap; click again to{" "}
                    <b style={{ color: "#b91c1c" }}>exclude</b> it.
                  </span>
                </div>
                {gapIncludes.size > 1 && (
                  <div className="modeseg" role="group" aria-label="Combine required gaps">
                    <button className={gapMode === "all" ? "on" : ""} onClick={() => setGapMode("all")} title="Projects missing ALL of the selected fields">
                      Match all
                    </button>
                    <button className={gapMode === "any" ? "on" : ""} onClick={() => setGapMode("any")} title="Projects missing ANY of the selected fields">
                      Match any
                    </button>
                  </div>
                )}
              </div>
              <div className="gap-chips">
                {GAP_FIELDS.map((g) => {
                  const included = gapIncludes.has(g);
                  const excluded = gapExcludes.has(g);
                  const state = included ? "include" : excluded ? "exclude" : "none";
                  return (
                    <button
                      key={g}
                      className={`gap-chip gap-chip-${state}`}
                      title={
                        state === "include"
                          ? `Showing only projects ${MISSING_PILL[g] ?? g} — click to flip to "has it"`
                          : state === "exclude"
                          ? `Hiding projects ${MISSING_PILL[g] ?? g} — click to clear`
                          : `Click to show only projects ${MISSING_PILL[g] ?? g}`
                      }
                      onClick={() => {
                        if (state === "none") {
                          setGapIncludes((prev) => new Set(prev).add(g));
                        } else if (state === "include") {
                          setGapIncludes((prev) => {
                            const n = new Set(prev);
                            n.delete(g);
                            return n;
                          });
                          setGapExcludes((prev) => new Set(prev).add(g));
                        } else {
                          setGapExcludes((prev) => {
                            const n = new Set(prev);
                            n.delete(g);
                            return n;
                          });
                        }
                      }}
                    >
                      <span className="gap-chip__mark" aria-hidden>
                        {state === "include" ? "✓" : state === "exclude" ? "✕" : "+"}
                      </span>
                      {MISSING_PILL[g] ?? g}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeFilterCount > 0 && (
              <div className="filteractions">
                <button className="btn-sm" onClick={clearFilters}>
                  Clear all filters ({activeFilterCount})
                </button>
              </div>
            )}
          </div>
        </FilterBar>

        {/* Select-all-drafts control for the current view */}
        {filteredDrafts.length > 0 && (
          <div className="selectall">
            <button className="tlink" onClick={selectAllFilteredDrafts}>
              {allFilteredDraftsSelected
                ? `Deselect ${filteredDrafts.length} draft${filteredDrafts.length !== 1 ? "s" : ""}`
                : `Select all ${filteredDrafts.length} draft${filteredDrafts.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}

        {/* Bulk action bar — appears when projects are selected */}
        {selectedIds.size > 0 && (
          <div className="batchbar">
            <span>
              {selectedIds.size} selected
              {selectedDraftCount > 0 && ` · ${selectedDraftCount} draft`}
              {selectedPublishedCount > 0 && ` · ${selectedPublishedCount} published`}
            </span>
            {selectedDraftCount > 0 && (
              <button
                className="btn btn-dark"
                onClick={batchPublish}
                disabled={batchBusy}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {batchBusy ? "…" : `Publish ${selectedDraftCount}`}
              </button>
            )}
            {selectedPublishedCount > 0 && (
              <button
                className="btn-sm"
                onClick={batchHide}
                disabled={batchBusy}
                style={{ padding: "6px 14px" }}
              >
                {batchBusy ? "…" : `Hide ${selectedPublishedCount}`}
              </button>
            )}
            {selectedIds.size === 2 && (
              <button
                className="btn-sm"
                onClick={() => setMerging(true)}
                disabled={batchBusy}
                style={{ padding: "6px 14px", color: "var(--accent)", borderColor: "var(--accent)" }}
                title="Merge these two records into one project (e.g. same project across two semesters)"
              >
                Merge 2
              </button>
            )}
            <button
              className="btn-sm"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={batchBusy}
              style={{ padding: "6px 14px", color: "#b91c1c", borderColor: "#fca5a5" }}
            >
              Delete {selectedIds.size}
            </button>
            <button className="tlink" onClick={() => setSelectedIds(new Set())} style={{ fontSize: 12 }}>
              Clear
            </button>
          </div>
        )}

        {/* Result count */}
        {!loading && (
          <div className="rescount">
            Showing <b>{filtered.length}</b> of <b>{projects.length}</b> projects
          </div>
        )}

        {/* Inline diagnose panel */}
        {diagnosing && (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              marginBottom: 18,
              overflow: "hidden",
              fontFamily: "var(--mono)",
              fontSize: 13,
            }}
          >
            {/* Panel header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 16px",
                background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <span style={{ fontWeight: 700, color: "var(--ink)", flex: 1 }}>
                Draft diagnosis —{" "}
                <span style={{ color: "#22c55e" }}>{readyDraftProjects.length} ready</span>
                {" · "}
                <span
                  style={{
                    color:
                      draftProjects.length - readyDraftProjects.length > 0 ? "#ef4444" : "var(--faint)",
                  }}
                >
                  {draftProjects.length - readyDraftProjects.length} blocked
                </span>
              </span>
              {readyDraftProjects.length > 0 && (
                <button
                  className="btn btn-dark"
                  onClick={() => setConfirmPublishAll(true)}
                  disabled={diagnoseBusy}
                  style={{ padding: "5px 14px", fontSize: 12, whiteSpace: "nowrap" }}
                >
                  {diagnoseBusy ? "Publishing…" : `Publish all ${readyDraftProjects.length} ready`}
                </button>
              )}
              <button
                onClick={() => setDiagnosing(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--faint)",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: "0 4px",
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Ready group */}
            {readyDraftProjects.length > 0 && (
              <div>
                <div
                  style={{
                    padding: "6px 16px",
                    background: "#f0fdf4",
                    borderBottom: "1px solid #dcfce7",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#15803d",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Ready to publish
                </div>
                {readyDraftProjects.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 16px",
                      borderBottom: "1px solid #f3f4f6",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#22c55e",
                        flexShrink: 0,
                        display: "inline-block",
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        color: "var(--ink)",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.title}
                      {p.partner && (
                        <span style={{ color: "var(--faint)", fontWeight: 400 }}> · {p.partner}</span>
                      )}
                    </span>
                    {!mine(p) && (
                      <span
                        title={lockedTitle(p)}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          color: "var(--ink-3)",
                          border: "1px solid var(--line)",
                          borderRadius: 5,
                          padding: "1px 6px",
                        }}
                      >
                        {orgLabel(p.ownerOrg ?? "spark")}
                      </span>
                    )}
                    <button
                      className="hidebtn"
                      onClick={() => togglePublish(p)}
                      disabled={busy === p.id || !mine(p)}
                      title={mine(p) ? undefined : lockedTitle(p)}
                      style={{
                        fontSize: 11,
                        padding: "4px 10px",
                        color: "#15803d",
                        borderColor: "#86efac",
                        opacity: mine(p) ? 1 : 0.45,
                        cursor: mine(p) ? "pointer" : "not-allowed",
                      }}
                    >
                      {busy === p.id ? "…" : "Publish"}
                    </button>
                    {mine(p) ? (
                      <Link href={`/admin/edit/${p.id}`} className="editlink" style={{ fontSize: 11 }}>
                        Edit
                      </Link>
                    ) : (
                      // Still linked, because the edit page renders read-only for
                      // another team's project — useful for looking, not changing.
                      <Link
                        href={`/admin/edit/${p.id}`}
                        className="editlink"
                        title={lockedTitle(p)}
                        style={{ fontSize: 11, opacity: 0.55 }}
                      >
                        View only
                      </Link>
                    )}
                    <Link
                      href={`/admin/projects/${p.id}`}
                      className="editlink"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "var(--sec)" }}
                    >
                      View ↗
                    </Link>
                  </div>
                ))}
              </div>
            )}

            {/* Blocked group */}
            {draftProjects.filter((p) => publishBlockers(p).length > 0).length > 0 && (
              <div>
                <div
                  style={{
                    padding: "6px 16px",
                    background: "#fff7f7",
                    borderBottom: "1px solid #fee2e2",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#b91c1c",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Blocked
                </div>
                {draftProjects
                  .filter((p) => publishBlockers(p).length > 0)
                  .map((p) => {
                    const blockers = publishBlockers(p);
                    const dotColor = blockers.length === 1 ? "#f59e0b" : "#ef4444";
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 16px",
                          borderBottom: "1px solid #f3f4f6",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: dotColor,
                            flexShrink: 0,
                            display: "inline-block",
                          }}
                        />
                        <span
                          style={{
                            flex: 1,
                            color: "var(--ink)",
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 120,
                          }}
                        >
                          {p.title}
                          {p.partner && (
                            <span style={{ color: "var(--faint)", fontWeight: 400 }}> · {p.partner}</span>
                          )}
                        </span>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {blockers.map((b) => (
                            <span
                              key={b}
                              style={{
                                fontFamily: "var(--mono)",
                                fontSize: 10,
                                fontWeight: 600,
                                color: "#b91c1c",
                                background: "#fee2e2",
                                border: "1px solid #fca5a5",
                                borderRadius: 4,
                                padding: "1px 6px",
                              }}
                            >
                              no {b}
                            </span>
                          ))}
                        </div>
                        <Link href={`/admin/edit/${p.id}`} className="editlink" style={{ fontSize: 11 }}>
                          Edit
                        </Link>
                        <Link
                          href={`/admin/projects/${p.id}`}
                          className="editlink"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: "var(--sec)" }}
                        >
                          View ↗
                        </Link>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Project list — elevated record cards */}
        {loading ? (
          <div className="reclist">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="card sk" style={{ height: 96, borderRadius: 16 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rec-empty">
            {hasActiveFilters ? (
              <>
                No projects match your filters.{" "}
                <button className="tlink" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                No projects yet.{" "}
                <Link className="tlink" href="/admin/inbox">
                  Check the import inbox →
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="reclist">
            {filtered.map((p) => {
              const missing = missingInfo(p);
              const team = missingTeam(p);
              const review = reviewFlags(p);
              const isDraft = p.published === false;
              const blockers = isDraft ? publishBlockers(p) : [];
              const dotColor = !isDraft
                ? "transparent"
                : blockers.length === 0
                ? "#22c55e"
                : blockers.length === 1
                ? "#f59e0b"
                : "#ef4444";
              const dotTitle = !isDraft
                ? ""
                : blockers.length === 0
                ? "Ready to publish"
                : `Publish blockers: ${blockers.join(", ")}`;
              const disc = primaryDiscipline(p);
              const dc = disciplineColor(disc);
              const selected = selectedIds.has(p.id);
              const menuOpen = openMenuId === p.id;
              const rowBusy = busy === p.id;
              return (
                <div
                  key={p.id}
                  className={`rec${isDraft ? " draft" : ""}${menuOpen ? " menuopen" : ""}`}
                  onClick={() => router.push(`/admin/projects/${p.id}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/admin/projects/${p.id}`);
                  }}
                >
                  {/* Left status accent rail: solid teal = published, dashed grey = draft */}
                  <div
                    className="rec-accent"
                    style={isDraft ? undefined : { background: "var(--teal)" }}
                  />

                  {/* Select + completeness flag column */}
                  <div className="rec-sel" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelect(p.id)}
                      style={{ accentColor: "var(--teal)", cursor: "pointer" }}
                      title="Select for bulk actions"
                    />
                    {isDraft ? (
                      <span
                        title={dotTitle}
                        style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block" }}
                      />
                    ) : (
                      <span style={{ width: 8, height: 8 }} />
                    )}
                  </div>

                  {/* Discipline cover tile */}
                  <div
                    className="rec-cover"
                    style={{ background: `linear-gradient(150deg, ${dc}, color-mix(in oklab, ${dc} 55%, #000))` }}
                    title={disc}
                  >
                    <span className="rec-abbr">{disciplineAbbr(disc)}</span>
                  </div>

                  {/* Body */}
                  <div className="rec-body">
                    <div className="rec-titlerow">
                      <span className="rec-ttl">{p.title}</span>
                      {p.featured && (
                        <span className="badge b-teal" title="Featured on the gallery">★ featured</span>
                      )}
                      {p.pdUrl && !p.blurb?.trim() && (
                        <span
                          className="badge"
                          title="Has a PD doc but no blurb — doc may be private (requires BU login to sync)"
                          style={{ color: "#7c3aed", background: "#7c3aed14", border: "1px solid #7c3aed44" }}
                        >
                          pd locked
                        </span>
                      )}
                    </div>

                    {/* Meta line: status token leads, then client · term · discipline */}
                    <div className="rec-mt">
                      {isDraft ? (
                        <span className="statustok draft" title={dotTitle}>
                          <span className="d" />
                          Draft
                        </span>
                      ) : (
                        <span className="statustok pub">
                          <span className="d" />
                          Published
                        </span>
                      )}
                      {p.partner && (
                        <>
                          <span className="rec-mi">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3" />
                            </svg>
                            {p.partner}
                          </span>
                          <span className="rec-sp">·</span>
                        </>
                      )}
                      <span className="rec-mi">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <path d="M3 10h18M8 2v4M16 2v4" />
                        </svg>
                        {latestTerm(p)}
                      </span>
                      <span className="rec-sp">·</span>
                      <span>{disc}</span>
                    </div>

                    {/* Completeness meter */}
                    <div className="rec-meter">
                      <div className="pips">
                        {missing.length === 0 && team.length === 0 && review.length === 0 && (
                          <span className="complete-tag">✓ Complete</span>
                        )}
                        {missing.length > 0 &&
                          PIP_FIELDS.map((f) => {
                            const has = !missing.includes(f.key);
                            return (
                              <span
                                key={f.key}
                                className={`pip ${has ? "has" : "miss"}`}
                                title={has ? `Has ${f.label}` : `Missing ${f.label}`}
                              >
                                <span className="pd" />
                                {f.label}
                              </span>
                            );
                          })}
                        {missing
                          .filter((m) => !PIP_FIELDS.some((f) => f.key === m))
                          .map((m) => (
                            <span key={m} className="pip miss" title={`Missing ${m}`}>
                              <span className="pd" />
                              {MISSING_PILL[m] ?? m}
                            </span>
                          ))}
                        {team.length > 0 && (
                          <span className="pip miss" title={`Missing team roles: ${team.join(", ")}`}>
                            <span className="pd" />
                            {team.length === 3 ? "No team" : `No ${team.join("/")}`}
                          </span>
                        )}
                        {review.includes("Dataset link") && (
                          <span className="pip miss" title="Auto-scraped dataset link — verify it points to the right source">
                            <span className="pd" />
                            Uncertain dataset
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action cluster */}
                  <div className="rec-tools" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="rec-tool"
                      onClick={() => toggleFeatured(p)}
                      disabled={rowBusy}
                      title={p.featured ? "Unfeature" : "Feature on gallery"}
                      aria-label={p.featured ? "Unfeature" : "Feature"}
                      style={{ color: p.featured ? "var(--teal-deep)" : undefined }}
                    >
                      <span style={{ fontSize: 16, lineHeight: 1 }}>{p.featured ? "★" : "☆"}</span>
                    </button>
                    <Link
                      href={`/admin/edit/${p.id}`}
                      className="rec-tool edit"
                      title="Open the full edit form"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </Link>
                    <button
                      className="rec-tool"
                      onClick={() => onToggleClick(p)}
                      disabled={rowBusy}
                      title={isDraft ? "Publish" : "Hide from gallery"}
                      aria-label={isDraft ? "Publish" : "Hide from gallery"}
                    >
                      {isDraft ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.9 5A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a13 13 0 0 1-2.3 3M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.5-1.1" />
                          <path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                    <div className="rec-menu-wrap" style={{ position: "relative" }}>
                      <button
                        className="rec-tool"
                        onClick={() => setOpenMenuId(menuOpen ? null : p.id)}
                        title="More"
                        aria-label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                      {menuOpen && (
                        <div className="rec-pop" role="menu">
                          <button className="mi-item" onClick={() => copyPublicLink(p)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="11" height="11" rx="2" />
                              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                            </svg>
                            Copy public link
                          </button>
                          <button className="mi-item" onClick={() => viewInGallery(p)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                              <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                            </svg>
                            View in gallery
                          </button>
                          <button
                            className="mi-item"
                            onClick={() => {
                              setOpenMenuId(null);
                              onToggleClick(p);
                            }}
                          >
                            {isDraft ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9.9 5A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a13 13 0 0 1-2.3 3M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.5-1.1" />
                                <path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                              </svg>
                            )}
                            {isDraft ? "Publish" : "Hide from gallery"}
                          </button>
                          <div className="mi-sep" />
                          <button
                            className="mi-item danger"
                            onClick={() => {
                              setOpenMenuId(null);
                              setRemoveTarget(p);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                            </svg>
                            Delete permanently
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Merge two selected projects */}
      {merging && selectedProjects.length === 2 && (
        <MergeProjectsModal
          a={selectedProjects[0]}
          b={selectedProjects[1]}
          onClose={() => setMerging(false)}
          onMerged={() => {
            setMerging(false);
            setSelectedIds(new Set());
            notify("ok", "Projects merged.");
            void refresh();
          }}
        />
      )}

      {/* Confirm "Publish all ready" */}
      <ConfirmModal
        open={confirmPublishAll}
        title={`Publish ${readyDraftProjects.length} draft${readyDraftProjects.length !== 1 ? "s" : ""}?`}
        body={
          <>
            These projects will become immediately visible on the public gallery. Please{" "}
            <strong>manually review</strong> each one before confirming — auto-checks only verify that a
            blurb and course run are present, not content quality.
          </>
        }
        confirmLabel="Yes, publish all"
        onConfirm={publishAllReadyConfirmed}
        onCancel={() => setConfirmPublishAll(false)}
      />

      {/* Confirm single remove */}
      <ConfirmModal
        open={!!removeTarget}
        title="Remove project?"
        body={
          <>
            Remove <strong>{removeTarget?.title}</strong> permanently? This can&rsquo;t be undone.
          </>
        }
        confirmLabel="Remove"
        danger
        onConfirm={removeConfirmed}
        onCancel={() => setRemoveTarget(null)}
      />

      {/* Confirm hiding a published project */}
      <ConfirmModal
        open={!!hideTarget}
        title="Hide from gallery?"
        body={
          <>
            <strong>{hideTarget?.title}</strong> will no longer appear on the public gallery. You can
            show it again any time.
          </>
        }
        confirmLabel="Hide"
        onConfirm={hideConfirmed}
        onCancel={() => setHideTarget(null)}
      />

      {/* Confirm bulk delete */}
      <ConfirmModal
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} project${selectedIds.size !== 1 ? "s" : ""}?`}
        body={
          <>
            <p style={{ margin: "0 0 10px" }}>
              This permanently removes the following and can&rsquo;t be undone:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 200, overflowY: "auto", fontSize: 13 }}>
              {selectedProjects.map((p) => (
                <li key={p.id} style={{ marginBottom: 3 }}>
                  {p.title}
                </li>
              ))}
            </ul>
          </>
        }
        confirmLabel={`Delete ${selectedIds.size}`}
        danger
        onConfirm={batchDeleteConfirmed}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Inline styles for page-local classes not in spark-control.css */}
      <style>{`
        .spark-control .segwrap { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
        /* Record cards */
        .spark-control .reclist { display: flex; flex-direction: column; gap: 10px; }
        .spark-control .rec { position: relative; display: flex; align-items: stretch; gap: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; cursor: pointer; box-shadow: var(--sh-sm); transition: transform .16s, box-shadow .16s, border-color .16s; }
        .spark-control .rec:hover { transform: translateY(-3px); box-shadow: var(--sh-lg); }
        .spark-control .rec.menuopen { z-index: 30; }
        .spark-control .rec-accent { width: 5px; flex-shrink: 0; border-radius: 16px 0 0 16px; background: repeating-linear-gradient(135deg,#cfd6d1 0 5px,#e2e7e3 5px 10px); }
        .spark-control .rec-sel { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 0 10px 0 14px; flex-shrink: 0; }
        .spark-control .rec-cover { width: 74px; flex-shrink: 0; margin: 14px 0 14px 0; border-radius: 12px; display: grid; place-items: center; position: relative; overflow: hidden; color: #fff; box-shadow: 0 4px 12px -4px rgba(12,20,18,.35); }
        .spark-control .rec-cover::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120% 100% at 80% 10%, rgba(255,255,255,.28), transparent 60%); }
        .spark-control .rec-abbr { font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: .05em; z-index: 1; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
        .spark-control .rec-body { flex: 1; min-width: 0; padding: 15px 18px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 7px; }
        .spark-control .rec-titlerow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; }
        .spark-control .rec-ttl { font-family: var(--display); font-weight: 600; font-size: 16px; letter-spacing: -.01em; color: var(--ink); }
        .spark-control .rec-mt { font-family: var(--mono); font-size: 11.5px; color: var(--ink-4); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
        .spark-control .rec-mi { display: inline-flex; align-items: center; gap: 5px; }
        .spark-control .rec-mt svg { width: 12px; height: 12px; opacity: .6; }
        .spark-control .rec-sp { color: #cfd6d1; }
        /* completeness meter */
        .spark-control .rec-meter { display: flex; align-items: center; gap: 9px; margin-top: 2px; }
        .spark-control .pips { display: flex; gap: 5px; flex-wrap: wrap; }
        .spark-control .pip { display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 9.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px 2px 6px; border-radius: 6px; border: 1px solid; }
        .spark-control .pip.has { color: var(--teal-deep); background: color-mix(in oklab, var(--teal) 9%, #fff); border-color: color-mix(in oklab, var(--teal) 22%, #fff); }
        .spark-control .pip.miss { color: var(--amber); background: var(--amber-bg); border-color: var(--amber-line); }
        .spark-control .pip .pd { width: 5px; height: 5px; border-radius: 50%; }
        .spark-control .pip.has .pd { background: var(--teal); }
        .spark-control .pip.miss .pd { background: var(--amber); box-shadow: 0 0 0 2px color-mix(in oklab, var(--amber) 25%, #fff); }
        .spark-control .complete-tag { font-family: var(--mono); font-size: 10px; font-weight: 600; color: var(--grn); background: var(--grn-bg); border: 1px solid var(--grn-line); border-radius: 6px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 5px; }
        /* status token */
        .spark-control .statustok { font-family: var(--mono); font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; }
        .spark-control .statustok .d { width: 6px; height: 6px; border-radius: 50%; }
        .spark-control .statustok.pub { color: var(--teal-deep); background: color-mix(in oklab, var(--teal) 11%, #fff); }
        .spark-control .statustok.pub .d { background: var(--teal); box-shadow: 0 0 7px var(--teal); }
        .spark-control .statustok.draft { color: var(--ink-3); background: var(--bg2); }
        .spark-control .statustok.draft .d { background: var(--ink-4); }
        /* action cluster */
        .spark-control .rec-tools { display: flex; align-items: center; gap: 6px; padding: 0 16px 0 8px; flex-shrink: 0; }
        .spark-control .rec-tool { width: 38px; height: 38px; border-radius: 11px; border: 1px solid var(--line); background: var(--panel); cursor: pointer; display: grid; place-items: center; color: var(--ink-3); transition: all .14s; text-decoration: none; }
        .spark-control .rec-tool svg { width: 17px; height: 17px; }
        .spark-control .rec-tool:hover { border-color: var(--ink-4); color: var(--ink); transform: translateY(-1px); }
        .spark-control .rec-tool:disabled { opacity: .5; cursor: not-allowed; }
        .spark-control .rec-tool.edit { color: var(--teal-deep); border-color: color-mix(in oklab, var(--teal) 30%, #fff); background: color-mix(in oklab, var(--teal) 7%, #fff); }
        .spark-control .rec-tool.edit:hover { background: color-mix(in oklab, var(--teal) 13%, #fff); border-color: var(--teal); color: var(--teal-deep); }
        /* kebab popover — escapes the card clip */
        .spark-control .rec-pop { position: absolute; top: 46px; right: 0; z-index: 40; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--sh-lg); padding: 6px; min-width: 180px; }
        .spark-control .mi-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: none; cursor: pointer; font-family: var(--body); font-size: 13.5px; color: var(--ink-2); padding: 9px 11px; border-radius: 8px; text-align: left; }
        .spark-control .mi-item svg { width: 15px; height: 15px; color: var(--ink-4); }
        .spark-control .mi-item:hover { background: var(--bg2); color: var(--ink); }
        .spark-control .mi-item.danger { color: var(--rose); } .spark-control .mi-item.danger svg { color: var(--rose); }
        .spark-control .mi-item.danger:hover { background: var(--rose-bg); }
        .spark-control .mi-sep { height: 1px; background: var(--line-2); margin: 5px 4px; }
        .spark-control .rec-empty { padding: 48px 20px; text-align: center; color: var(--ink-4); font-size: 14.5px; background: var(--panel); border: 1px dashed var(--field); border-radius: 16px; }
        @media (max-width: 1040px) { .spark-control .rec-cover { display: none; } .spark-control .rec-tool.edit span { display: none; } .spark-control .rec-tool.edit { width: 38px; padding: 0; } }
        /* Filter panel: labeled dropdown grid + gaps block. */
        .filterpanel { display: flex; flex-direction: column; }
        .filtergrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px 16px; }
        .filteritem { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .filteritem .lab { margin-bottom: 0; }
        .filteritem select.fld { width: 100%; min-width: 0; padding: 9px 11px; font-size: 13px; }
        .gapsblock { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
        .gapshead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
        .gapstitle { display: block; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
        .gapshint { font-size: 12px; color: var(--faint); line-height: 1.4; }
        .modeseg { display: inline-flex; border: 1px solid var(--field); border-radius: 7px; overflow: hidden; flex-shrink: 0; }
        .modeseg button { font-family: var(--mono); font-size: 11px; font-weight: 600; padding: 6px 13px; background: #fff; color: var(--sec); border: none; cursor: pointer; transition: all .12s; }
        .modeseg button + button { border-left: 1px solid var(--field); }
        .modeseg button:hover { color: var(--ink); }
        .modeseg button.on { background: color-mix(in oklab, var(--accent) 12%, #fff); color: color-mix(in oklab, var(--accent) 72%, #000); }
        .filteractions { margin-top: 18px; }
        .selectall { font-family: var(--mono); font-size: 12px; margin-bottom: 12px; }
        .rescount { font-family: var(--mono); font-size: 12px; color: var(--faint); margin-bottom: 14px; }
        .rescount b { color: var(--ink); font-weight: 600; }
        .batchbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #0fa3921a; border: 1px solid #0fa39233; border-radius: 8px; margin-bottom: 14px; font-family: var(--mono); font-size: 13px; color: var(--ink); flex-wrap: wrap; }
        .gap-chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .gap-chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11.5px; font-weight: 600; border-radius: 999px; padding: 5px 12px; cursor: pointer; border: 1px solid; transition: all .12s; user-select: none; }
        .gap-chip__mark { font-size: 10px; line-height: 1; opacity: 0.8; }
        .gap-chip-none { color: var(--sec); background: #fff; border-color: var(--field); }
        .gap-chip-none:hover { border-color: var(--accent); color: var(--accent); }
        .gap-chip-none .gap-chip__mark { opacity: 0.5; }
        .gap-chip-include { color: #15803d; background: #dcfce7; border-color: #86efac; }
        .gap-chip-include:hover { background: #cdf3d8; }
        .gap-chip-exclude { color: #b91c1c; background: #fee2e2; border-color: #fca5a5; }
        .gap-chip-exclude:hover { background: #fdd5d5; }
      `}</style>
    </>
  );
}
