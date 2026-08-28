"use client";
// Standalone CDS-skinned project gallery (staging demo, mock data, no admin).
// Idea 1: the tower faint in the hero + the facade motif carried into every
// placeholder tile (louver fins + a stacked-box corner). Self-contained — it
// does NOT reuse the Spark <Gallery> or touch the DB.
import { useMemo, useState } from "react";

// A project as this gallery renders it — mapped from the real DB Project in
// app/cds/page.tsx. CDS shows only projects tagged with the "cds" surface.
export type CdsProject = {
  id: string;
  title: string;
  discipline: string;
  topics: string[];
  term: string;
  program: string;
  partner: string; // the CLIENT ORGANISATION (not a person)
  partnerUrl?: string; // the client org's website (link icon, only if set)
  clientDesc?: string; // "about the client" blurb (expandable dropdown, only if set)
  clientType: string;
  blurb: string;
  tech?: string[];
};

const ABBR: Record<string, string> = {
  UX: "UX", SWE: "SWE", ML: "ML", "Data Science": "DATA SCI",
  "Data Visualization": "DATAVIZ", Innovation: "INNOV",
};
const HUE: Record<string, number> = {
  UX: 25, SWE: 255, ML: 305, "Data Science": 160, "Data Visualization": 205, Innovation: 75,
};
const dcol = (d: string) => `oklch(0.62 0.14 ${HUE[d] ?? 260})`;
const DISC_PREF = Object.keys(ABBR); // preferred display order for the discipline facet
const abbr = (d: string) => ABBR[d] ?? d.slice(0, 7).toUpperCase();

// Newest-first ordering key parsed from "Season YYYY" (higher = newer).
const SEASON: Record<string, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };
function termOrder(t: string): number {
  const m = t.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return -1;
  return parseInt(m[2], 10) * 10 + (SEASON[m[1].toLowerCase()] ?? 0);
}
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

const HERO_IMG = "/cds-tower.jpg";

// ── Component ─────────────────────────────────────────────────────────────────
export default function CDSGallery({ projects }: { projects: CdsProject[] }) {
  const [q, setQ] = useState("");
  const [disc, setDisc] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [ctypes, setCtypes] = useState<Set<string>>(new Set());
  const [progs, setProgs] = useState<Set<string>>(new Set());
  const [terms, setTerms] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"term" | "az">("term");
  const [showFilters, setShowFilters] = useState(false);
  const [sel, setSel] = useState<CdsProject | null>(null); // open project detail

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (v: string) =>
    set((prev) => {
      const n = new Set(prev);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });

  const active = disc.size + topics.size + ctypes.size + progs.size + terms.size + (q ? 1 : 0);
  const clearAll = () => { setQ(""); setDisc(new Set()); setTopics(new Set()); setCtypes(new Set()); setProgs(new Set()); setTerms(new Set()); };

  const count = (key: keyof CdsProject | "topics") => {
    const m: Record<string, number> = {};
    for (const p of projects) {
      const vals = key === "topics" ? p.topics : [p[key] as string];
      for (const v of vals) if (v) m[v] = (m[v] || 0) + 1;
    }
    return m;
  };
  const counts = useMemo(() => ({
    discipline: count("discipline"), topics: count("topics"),
    clientType: count("clientType"), program: count("program"), term: count("term"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projects]);

  // Facet option lists derived from the actual data (never stale / empty-mismatched).
  const vocab = useMemo(() => {
    const byPref = (a: string, b: string) => {
      const ia = DISC_PREF.indexOf(a), ib = DISC_PREF.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    };
    return {
      disciplines: uniq(projects.map((p) => p.discipline)).sort(byPref),
      topics: uniq(projects.flatMap((p) => p.topics)).sort((a, b) => a.localeCompare(b)),
      clientTypes: uniq(projects.map((p) => p.clientType)).sort((a, b) => a.localeCompare(b)),
      programs: uniq(projects.map((p) => p.program)).sort((a, b) => a.localeCompare(b)),
      terms: uniq(projects.map((p) => p.term)).sort((a, b) => termOrder(b) - termOrder(a)),
    };
  }, [projects]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (disc.size && !disc.has(p.discipline)) return false;
      if (topics.size && !p.topics.some((t) => topics.has(t))) return false;
      if (ctypes.size && !ctypes.has(p.clientType)) return false;
      if (progs.size && !progs.has(p.program)) return false;
      if (terms.size && !terms.has(p.term)) return false;
      if (needle) {
        const hay = [p.title, p.blurb, p.partner, p.discipline, p.program, ...p.topics].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) =>
      sort === "az" ? a.title.localeCompare(b.title) : termOrder(b.term) - termOrder(a.term) || a.title.localeCompare(b.title),
    );
  }, [q, disc, topics, ctypes, progs, terms, sort, projects]);

  const projectsCount = projects.length;
  const partnersCount = new Set(projects.map((p) => p.partner)).size;

  const Facet = ({ title, values, sel, on, cnt }: {
    title: string; values: string[]; sel: Set<string>; on: (v: string) => void; cnt: Record<string, number>;
  }) => (
    <div className="cg-facet">
      <div className="cg-facet-h">{title}</div>
      {values.map((v) => (
        <label key={v} className={`cg-opt${sel.has(v) ? " on" : ""}`}>
          <input type="checkbox" checked={sel.has(v)} onChange={() => on(v)} />
          <span className="cg-box" aria-hidden>{sel.has(v) ? "✓" : ""}</span>
          <span className="cg-optlabel">{v}</span>
          <span className="cg-optn">{cnt[v] || 0}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="cg-root">
      <style>{CSS}</style>

      {/* Masthead */}
      <header className="cg-mast">
        <div className="cg-mast-in">
          <span className="cg-mark"><span></span><span></span><span></span><span></span></span>
          <span className="cg-word">BU CDS</span>
          <span className="cg-crumb">Faculty of Computing &amp; Data Sciences · Project Gallery</span>
        </div>
      </header>

      {/* Hero with faint tower + fins */}
      <section className="cg-hero">
        <div className="cg-hero-bg" style={{ backgroundImage: `url(${HERO_IMG})` }} />
        <div className="cg-hero-fins" />
        <div className="cg-hero-in">
          <div className="cg-eyebrow">Explore our work</div>
          <h1 className="cg-h1">Data-driven projects, built with real partners.</h1>
          <p className="cg-lede">Student teams from BU’s Faculty of Computing &amp; Data Sciences — searchable by discipline, topic, program, and the technologies behind each build.</p>
          <div className="cg-stats">
            <div className="cg-stat"><span className="n">{projectsCount}</span><span className="t">{projectsCount === 1 ? "project" : "projects"}</span></div>
            <div className="cg-stat"><span className="n">{partnersCount}</span><span className="t">partner organizations</span></div>
          </div>
        </div>
      </section>

      {/* Body */}
      <div className="cg-body">
        <aside className="cg-side">
          <button className="cg-filtbtn" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <span>Filters{active ? ` (${active})` : ""}</span><span aria-hidden>▾</span>
          </button>
          <div className={`cg-facets${showFilters ? " open" : ""}`}>
            <div className="cg-facets-head">
              <span>Filters</span>
              {active > 0 && <button className="cg-clear" onClick={clearAll}>Clear ({active})</button>}
            </div>
            {vocab.disciplines.length > 0 && <Facet title="Discipline" values={vocab.disciplines} sel={disc} on={toggle(setDisc)} cnt={counts.discipline} />}
            {vocab.topics.length > 0 && <Facet title="Topic" values={vocab.topics} sel={topics} on={toggle(setTopics)} cnt={counts.topics} />}
            {vocab.clientTypes.length > 0 && <Facet title="Client Type" values={vocab.clientTypes} sel={ctypes} on={toggle(setCtypes)} cnt={counts.clientType} />}
            {vocab.programs.length > 0 && <Facet title="Program" values={vocab.programs} sel={progs} on={toggle(setProgs)} cnt={counts.program} />}
            {vocab.terms.length > 0 && <Facet title="Term" values={vocab.terms} sel={terms} on={toggle(setTerms)} cnt={counts.term} />}
          </div>
        </aside>

        <main className="cg-main">
          <div className="cg-controls">
            <div className="cg-search">
              <span>⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects, partners, tech…" aria-label="Search" />
            </div>
            <select className="cg-sort" value={sort} onChange={(e) => setSort(e.target.value as "term" | "az")} aria-label="Sort">
              <option value="term">Newest first</option>
              <option value="az">A–Z</option>
            </select>
          </div>
          <div className="cg-count">{filtered.length} {filtered.length === 1 ? "project" : "projects"}</div>

          {filtered.length === 0 ? (
            <div className="cg-empty">No projects match your filters. <button onClick={clearAll}>Reset</button></div>
          ) : (
            <div className="cg-grid">
              {filtered.map((p) => (
                <a key={p.id} className="cg-card" href="#" onClick={(e) => { e.preventDefault(); setSel(p); }}>
                  <div
                    className="cg-thumb"
                    style={{
                      // discipline-tinted louver fins + facade tint (the tower motif)
                      ["--fin" as string]: `color-mix(in oklab, ${dcol(p.discipline)} 22%, transparent)`,
                      ["--t1" as string]: `color-mix(in oklab, ${dcol(p.discipline)} 14%, #fff)`,
                      ["--t2" as string]: `color-mix(in oklab, ${dcol(p.discipline)} 5%, #fff)`,
                    }}
                  >
                    <span className="cg-badge" style={{ background: dcol(p.discipline) }}>{abbr(p.discipline)}</span>
                    {p.topics[0] && <span className="cg-tpill">{p.topics[0]}</span>}
                    <span className="cg-tower" aria-hidden><i></i><i></i><i></i><i></i></span>
                  </div>
                  <div className="cg-meta">
                    <div className="cg-disc"><span className="cg-dot" style={{ background: dcol(p.discipline) }} />{p.discipline} · {p.term}</div>
                    <h3 className="cg-title">{p.title}</h3>
                    <p className="cg-blurb">{p.blurb}</p>
                    <div className="cg-foot"><span className="cg-partner">{p.partner}</span><span className="cg-view">View →</span></div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Project detail overlay — click a card to open (mock content) */}
      {sel && (
        <div className="cg-modal" onClick={() => setSel(null)}>
          <div className="cg-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={sel.title}>
            <button className="cg-x" onClick={() => setSel(null)} aria-label="Close">✕</button>
            <div
              className="cg-sheet-hero"
              style={{
                ["--fin" as string]: `color-mix(in oklab, ${dcol(sel.discipline)} 22%, transparent)`,
                ["--t1" as string]: `color-mix(in oklab, ${dcol(sel.discipline)} 14%, #fff)`,
                ["--t2" as string]: `color-mix(in oklab, ${dcol(sel.discipline)} 5%, #fff)`,
              }}
            >
              <span className="cg-badge" style={{ background: dcol(sel.discipline) }}>{abbr(sel.discipline)}</span>
              <span className="cg-tower" aria-hidden><i></i><i></i><i></i><i></i></span>
            </div>
            <div className="cg-sheet-body">
              <div className="cg-disc"><span className="cg-dot" style={{ background: dcol(sel.discipline) }} />{sel.discipline} · {sel.term} · {sel.program}</div>
              <h2 className="cg-sheet-title">{sel.title}</h2>

              {/* Client card — link icon by the name, expandable "about" */}
              <details className="cg-client" open>
                <summary>
                  <span className="cg-client-av">{sel.partner.replace(/^(The )/, "").trim().split(/[\s—-]+/).slice(0, 2).map((w) => w[0]).join("")}</span>
                  <span className="cg-client-mid">
                    <span className="cg-client-lab">Client</span>
                    <span className="cg-client-name">
                      {sel.partner}
                      {sel.partnerUrl && (
                        <a href={sel.partnerUrl} target="_blank" rel="noopener noreferrer" aria-label={`${sel.partner} website`} onClick={(e) => e.stopPropagation()}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                        </a>
                      )}
                    </span>
                  </span>
                  <span className="cg-client-type">{sel.clientType}</span>
                  {sel.clientDesc && <span className="cg-client-chev" aria-hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></span>}
                </summary>
                {sel.clientDesc && <div className="cg-client-desc">{sel.clientDesc}</div>}
              </details>

              <p className="cg-sheet-blurb">{sel.blurb}</p>

              <div className="cg-sheet-tags">
                {sel.topics.map((t) => <span key={t} className="cg-tag">{t}</span>)}
              </div>
              {sel.tech && sel.tech.length > 0 && (
                <>
                  <div className="cg-sheet-h">Tech Stack</div>
                  <div className="cg-sheet-tags">{sel.tech.map((t) => <span key={t} className="cg-tag mono">{t}</span>)}</div>
                </>
              )}
              <div className="cg-sheet-note">Demo gallery · real CDS project data.</div>
            </div>
          </div>
        </div>
      )}

      <footer className="cg-footer">
        <span className="cg-mark sm"><span></span><span></span><span></span><span></span></span>
        BU Faculty of Computing &amp; Data Sciences · Project Gallery · demo
      </footer>
    </div>
  );
}

// ── CDS visual identity (namespaced under .cg-root) ──────────────────────────
const CSS = `
.cg-root{
  --cds:#cc0000; --copper:#a5532a; --copper-d:#7f3d1d; --slate:#2b4a6f;
  --ink:#1a1614; --sub:#5b544f; --mut:#948b84; --line:#e9e2db; --bg:#fbf8f5;
  --disp:var(--font-fraunces),Georgia,serif; --body:var(--font-inter),system-ui,sans-serif; --mono:var(--font-mono),monospace;
  background:#fff; color:var(--ink); font-family:var(--body); min-height:100vh;
}
.cg-root *{box-sizing:border-box;}
.cg-mast{border-top:3px solid var(--copper);border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:20;}
.cg-mast-in{max-width:1280px;margin:0 auto;height:58px;display:flex;align-items:center;gap:12px;padding:0 32px;}
.cg-mark{width:24px;height:28px;display:flex;flex-direction:column;gap:2px;justify-content:center;flex:0 0 auto;}
.cg-mark span{height:4.5px;border-radius:1px;display:block;}
.cg-mark span:nth-child(1){width:70%;background:var(--slate);margin-left:30%;}
.cg-mark span:nth-child(2){width:85%;background:var(--copper);}
.cg-mark span:nth-child(3){width:60%;background:var(--slate);margin-left:20%;}
.cg-mark span:nth-child(4){width:90%;background:var(--copper-d);}
.cg-word{font-family:var(--disp);font-weight:700;font-size:17px;letter-spacing:-.01em;}
.cg-crumb{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);}

.cg-hero{position:relative;overflow:hidden;background:var(--bg);border-bottom:1px solid var(--line);}
.cg-hero-bg{position:absolute;inset:0;background-size:cover;background-position:80% 15%;opacity:.30;
  -webkit-mask-image:linear-gradient(95deg,transparent 0 24%,#000 78%);mask-image:linear-gradient(95deg,transparent 0 24%,#000 78%);}
.cg-hero-fins{position:absolute;inset:0;background-image:repeating-linear-gradient(90deg,rgba(40,30,20,.06) 0 1px,transparent 1px 10px);opacity:.6;pointer-events:none;}
.cg-hero-in{position:relative;z-index:1;max-width:1280px;margin:0 auto;padding:46px 32px 40px;}
.cg-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--copper);font-weight:600;margin-bottom:12px;}
.cg-h1{font-family:var(--disp);font-weight:700;font-size:clamp(30px,4vw,46px);line-height:1.04;letter-spacing:-.015em;margin:0;max-width:640px;}
.cg-lede{font-size:16px;line-height:1.55;color:var(--sub);max-width:560px;margin:16px 0 0;}
.cg-stats{display:flex;gap:36px;margin-top:24px;}
.cg-stat .n{font-family:var(--disp);font-weight:700;font-size:32px;color:var(--copper);letter-spacing:-.02em;}
.cg-stat .t{font-family:var(--disp);font-weight:600;font-size:16px;color:var(--mut);margin-left:8px;}

.cg-body{max-width:1280px;margin:0 auto;padding:24px 32px 100px;display:grid;grid-template-columns:248px 1fr;gap:44px;align-items:start;}
.cg-side{position:sticky;top:74px;}
.cg-filtbtn{display:none;}
.cg-facets-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.cg-facets-head span{font-family:var(--disp);font-weight:700;font-size:16px;}
.cg-clear{background:none;border:none;cursor:pointer;font-family:var(--mono);font-size:12px;color:var(--copper);}
.cg-facet{margin-bottom:24px;}
.cg-facet-h{font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);margin-bottom:11px;}
.cg-opt{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13.5px;color:var(--sub);padding:2px 0;margin-bottom:2px;}
.cg-opt.on{color:var(--ink);}
.cg-opt input{position:absolute;opacity:0;width:0;height:0;}
.cg-box{width:17px;height:17px;border-radius:3px;flex:0 0 auto;border:1px solid #cdbfb2;background:#fff;display:grid;place-items:center;color:#fff;font-size:11px;}
.cg-opt.on .cg-box{background:var(--copper);border-color:var(--copper);}
.cg-optlabel{flex:1;}
.cg-optn{font-family:var(--mono);font-size:11px;color:#bcae9f;}

.cg-controls{display:flex;gap:12px;margin-bottom:20px;}
.cg-search{flex:1;display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:0 14px;background:#fff;}
.cg-search span{color:#bcae9f;font-size:15px;}
.cg-search input{flex:1;border:none;outline:none;height:44px;font-size:14.5px;font-family:var(--body);background:transparent;color:var(--ink);}
.cg-sort{border:1px solid var(--line);border-radius:9px;padding:0 14px;font-size:14px;font-family:var(--body);color:var(--ink);background:#fff;cursor:pointer;}
.cg-count{font-family:var(--mono);font-size:12px;color:var(--mut);margin-bottom:18px;}
.cg-empty{padding:70px 0;text-align:center;color:var(--mut);font-size:15px;}
.cg-empty button{background:none;border:none;color:var(--copper);cursor:pointer;font-size:15px;}

.cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px;}
.cg-card{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff;text-decoration:none;color:inherit;display:flex;flex-direction:column;transition:transform .16s,box-shadow .16s,border-color .16s;}
.cg-card:hover{transform:translateY(-3px);box-shadow:0 12px 28px rgba(70,40,20,.12);border-color:#dcccbd;}
.cg-thumb{position:relative;aspect-ratio:4/3;overflow:hidden;
  background:repeating-linear-gradient(90deg,var(--fin) 0 2px,transparent 2px 9px),linear-gradient(150deg,var(--t1),var(--t2));}
.cg-badge{position:absolute;top:9px;left:9px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.08em;color:#fff;padding:3px 7px;border-radius:3px;z-index:2;}
.cg-tpill{position:absolute;bottom:9px;left:9px;font-family:var(--mono);font-size:8.5px;font-weight:600;background:rgba(255,255,255,.9);color:#3a322c;padding:3px 8px;border-radius:20px;z-index:2;}
.cg-tower{position:absolute;right:10px;bottom:10px;width:38px;display:flex;flex-direction:column;gap:2px;align-items:flex-end;opacity:.5;z-index:1;}
.cg-tower i{height:5px;border-radius:1px;display:block;}
.cg-tower i:nth-child(1){width:66%;background:var(--slate);}
.cg-tower i:nth-child(2){width:90%;background:var(--copper);}
.cg-tower i:nth-child(3){width:58%;background:var(--slate);}
.cg-tower i:nth-child(4){width:96%;background:var(--copper-d);}
.cg-meta{padding:13px 14px 15px;display:flex;flex-direction:column;flex:1;}
.cg-disc{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:8px;}
.cg-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}
.cg-title{font-family:var(--disp);font-weight:600;font-size:17px;line-height:1.18;letter-spacing:-.01em;margin:0 0 7px;}
.cg-blurb{font-size:13px;line-height:1.5;color:var(--sub);margin:0;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.cg-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #f1ebe4;margin-top:13px;padding-top:11px;}
.cg-partner{font-size:12px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cg-view{font-family:var(--mono);font-size:10px;color:var(--copper);flex:0 0 auto;margin-left:8px;}

.cg-footer{border-top:1px solid var(--line);background:var(--bg);padding:22px 32px;display:flex;align-items:center;gap:10px;justify-content:center;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);}
.cg-mark.sm{width:16px;height:19px;}
.cg-mark.sm span{height:3px;}

@media (max-width:900px){
  .cg-body{grid-template-columns:1fr;gap:20px;}
  .cg-side{position:static;}
  .cg-filtbtn{display:flex;align-items:center;justify-content:space-between;width:100%;cursor:pointer;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:#fff;font-family:var(--disp);font-weight:700;font-size:16px;color:var(--ink);}
  .cg-facets{display:none;border:1px solid var(--line);border-top:none;border-radius:0 0 10px 10px;padding:16px 16px 4px;}
  .cg-facets.open{display:block;}
  .cg-facets-head{display:none;}
}
/* Detail overlay */
.cg-modal{position:fixed;inset:0;z-index:60;background:rgba(26,22,20,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:48px 20px;overflow-y:auto;}
.cg-sheet{position:relative;width:100%;max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(40,20,10,.35);}
.cg-x{position:absolute;top:14px;right:14px;z-index:3;width:34px;height:34px;border-radius:50%;border:none;background:rgba(255,255,255,.9);color:var(--ink);font-size:15px;cursor:pointer;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.12);}
.cg-sheet-hero{position:relative;aspect-ratio:16/7;overflow:hidden;background:repeating-linear-gradient(90deg,var(--fin) 0 2px,transparent 2px 9px),linear-gradient(150deg,var(--t1),var(--t2));}
.cg-sheet-hero .cg-tower{width:52px;}
.cg-sheet-body{padding:22px 26px 28px;}
.cg-sheet-title{font-family:var(--disp);font-weight:700;font-size:26px;line-height:1.1;letter-spacing:-.015em;margin:4px 0 18px;}
.cg-client{background:color-mix(in oklab,var(--copper) 6%,#faf7f4);border:1px solid color-mix(in oklab,var(--copper) 16%,#eee);border-radius:11px;margin-bottom:20px;}
.cg-client>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:13px;padding:14px 16px;}
.cg-client>summary::-webkit-details-marker{display:none;}
.cg-client[open] .cg-client-chev{transform:rotate(180deg);}
.cg-client-av{width:42px;height:42px;flex:0 0 auto;border-radius:8px;background:#fff;border:1px solid #eadfd5;display:grid;place-items:center;font-family:var(--disp);font-weight:700;font-size:15px;color:var(--copper);}
.cg-client-mid{min-width:0;flex:1;}
.cg-client-lab{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);}
.cg-client-name{display:flex;align-items:center;gap:7px;font-family:var(--disp);font-weight:600;font-size:16px;color:var(--ink);margin-top:2px;}
.cg-client-name a{display:inline-flex;color:var(--copper);}
.cg-client-type{flex:0 0 auto;font-family:var(--mono);font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--copper);border:1px solid color-mix(in oklab,var(--copper) 32%,#fff);border-radius:999px;padding:4px 10px;}
.cg-client-chev{flex:0 0 auto;color:#b6a798;display:inline-flex;transition:transform .18s;}
.cg-client-desc{padding:0 16px 15px 71px;font-size:13.5px;line-height:1.55;color:var(--sub);}
.cg-sheet-blurb{font-size:15px;line-height:1.6;color:var(--sub);margin:0 0 20px;}
.cg-sheet-h{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin:0 0 10px;}
.cg-sheet-tags{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px;}
.cg-tag{font-size:12.5px;color:#3a322c;border:1px solid var(--line);background:#fafafa;border-radius:4px;padding:4px 10px;}
.cg-tag.mono{font-family:var(--mono);font-size:12px;}
.cg-sheet-note{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#c3b6a8;border-top:1px solid #f1ebe4;padding-top:14px;}

@media (max-width:600px){
  .cg-mast-in,.cg-hero-in,.cg-body{padding-left:16px;padding-right:16px;}
  .cg-hero-bg{opacity:.22;}
  .cg-grid{grid-template-columns:1fr;}
  .cg-stats{gap:24px;}
  .cg-modal{padding:0;}
  .cg-sheet{max-width:none;min-height:100vh;border-radius:0;}
}
`;
