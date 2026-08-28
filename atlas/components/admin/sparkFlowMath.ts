// SPARK FLOW — pure geometry/term math for the role-journey streamgraph.
// Ported from the handoff flow-timeline.js but with NO DOM / innerHTML: these
// functions return plain data that the React component (SparkFlow.tsx) maps to
// real <svg> elements. Term axis: year*2 + (Fall?1:0); Spring sorts before Fall.

export interface RoleStint { role: string; start: string; end?: string | null }
export type DetailKind = "projects" | "track" | "event";
export interface RoleDetail { kind: DetailKind; label: string; byTerm: Record<string, string[]> }
export type DetailMap = Record<string, RoleDetail>;

const HUE: Record<string, number> = {
  Ambassador: 70, PM: 200, TPM: 250, EIR: 150, Mentor: 300, Judge: 25,
  "Guest Speaker": 335, "Senior Advisor": 280, "Tech Advisor": 110, "Program Lead": 45,
  Fellow: 175, "Workshop Host": 15, "Class Instructor": 95, Student: 220, Contributor: 220,
};
export function color(role: string, kind?: "solid" | "deep" | "tint"): string {
  const h = HUE[role] != null ? HUE[role] : 220;
  return kind === "deep"
    ? `oklch(0.44 0.13 ${h})`
    : kind === "tint"
    ? `oklch(0.95 0.045 ${h})`
    : `oklch(0.60 0.15 ${h})`;
}
function hueOf(r: string) { return HUE[r] != null ? HUE[r] : 220; }
export function itemColor(r: string, i: number, n: number): string {
  const h = hueOf(r);
  const L = n > 1 ? 0.5 + 0.22 * (i / (n - 1)) : 0.6;
  return `oklch(${L.toFixed(3)} 0.135 ${h})`;
}

export function parseTerm(t: string): number | null {
  const m = String(t).match(/(Spring|Fall|Summer)\s+(\d{4})/i);
  if (!m) return null;
  return +m[2] * 2 + (m[1].toLowerCase() === "fall" ? 1 : 0);
}
function dateAxis(d: Date): number {
  const y = d.getFullYear(), mo = d.getMonth();
  return mo < 7 ? y * 2 + mo / 7 : y * 2 + 1 + (mo - 7) / 5;
}
export function termLabel(i: number): string {
  return (i % 2 ? "Fa " : "Sp ") + String(Math.floor(i / 2)).slice(2);
}
// Catmull-Rom-ish smooth path through points.
export function curve(pts: number[][], lead: string): string {
  if (!pts.length) return "";
  let d = lead + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += " C" + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + "," + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)
      + " " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + "," + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)
      + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
  }
  return d;
}

interface NormRole { role: string; start: string; end: string | null; ongoing: boolean; s: number; e: number; }
function norm(roles: RoleStint[], now: Date) {
  const nowI = dateAxis(now);
  const rs: NormRole[] = [];
  for (const r of roles) {
    const s = parseTerm(r.start);
    if (s == null) continue;
    const e = r.end ? parseTerm(r.end) : Math.floor(nowI);
    rs.push({ role: r.role, start: r.start, end: r.end ?? null, ongoing: !r.end, s, e: Math.max(s, e ?? s) });
  }
  if (!rs.length) return { rs, a0: 0, a1: 0, N: 1, nowI };
  const minS = Math.min(...rs.map((r) => r.s));
  let maxE = Math.max(...rs.map((r) => r.e));
  maxE = Math.max(maxE, Math.ceil(nowI));
  return { rs, a0: minS, a1: maxE, N: maxE - minS + 1, nowI };
}

export function activeAt(roles: RoleStint[], date: Date): string[] {
  const d = norm(roles, date), t = d.nowI;
  return d.rs.filter((r) => r.s <= t && (r.ongoing ? true : r.e >= t - 0.999)).map((r) => r.role);
}
export function rangeTxt(r: { start: string; ongoing: boolean; end?: string | null }): string {
  return r.start + (r.ongoing ? " → present" : r.end && r.end !== r.start ? " → " + r.end : "");
}

export interface StreamBand {
  i: number; role: string; ongoing: boolean; start: string; end?: string | null;
  d: string; fill: string; durTerms: number; label?: { x: number; y: number };
}
export interface StreamModel {
  W: number; H: number;
  ticks: { x: number; label: string }[];
  bands: StreamBand[];
  nowX: number;
  legend: { role: string; fill: string }[];
}

export function computeStream(roles: RoleStint[], now: Date, height = 300): StreamModel {
  const H = height;
  const d = norm(roles, now);
  const padL = 14, padR = 14, colW = 132, W = Math.max(620, d.N * colW), plotW = W - padL - padR, midY = H / 2, TH = 30, GAP = 8;
  const xFor = (t: number) => padL + (t - d.a0) / Math.max(1, d.N - 1) * plotW;
  const z = d.rs.slice().sort((a, b) => a.s - b.s) as (NormRole & { smp?: Record<number, { top: number; bot: number }>; last?: number })[];
  z.forEach((r) => { r.smp = {}; r.last = r.ongoing ? Math.floor(d.nowI) : r.e; });
  for (let t = d.a0; t <= d.a1; t++) {
    const act = z.filter((r) => t >= r.s && t <= (r.last as number));
    const total = act.length * TH + (act.length - 1) * GAP;
    let y0 = midY - total / 2;
    act.forEach((r) => { r.smp![t] = { top: y0, bot: y0 + TH }; y0 += TH + GAP; });
  }
  const ticks: { x: number; label: string }[] = [];
  for (let t = d.a0; t <= d.a1; t++) ticks.push({ x: xFor(t), label: termLabel(t) });

  const bands: StreamBand[] = [];
  z.forEach((r, i) => {
    const keys = Object.keys(r.smp!).map(Number).sort((a, b) => a - b);
    if (!keys.length) return;
    const first = keys[0], last = keys[keys.length - 1];
    const cL = (r.smp![first].top + r.smp![first].bot) / 2;
    const top: number[][] = [[xFor(first - 0.5), cL]];
    keys.forEach((t) => top.push([xFor(t), r.smp![t].top]));
    let rightX: number; const cR = (r.smp![last].top + r.smp![last].bot) / 2;
    if (r.ongoing) { rightX = xFor(d.nowI); top.push([rightX, r.smp![last].top]); }
    else { rightX = xFor(last + 0.5); top.push([rightX, cR]); }
    const bot: number[][] = [r.ongoing ? [rightX, r.smp![last].bot] : [rightX, cR]];
    keys.slice().reverse().forEach((t) => bot.push([xFor(t), r.smp![t].bot]));
    bot.push([xFor(first - 0.5), cL]);
    let label: { x: number; y: number } | undefined;
    if (r.e - r.s >= 1) {
      const mt = keys[Math.floor(keys.length / 2)];
      label = { x: xFor(mt), y: (r.smp![mt].top + r.smp![mt].bot) / 2 + 4 };
    }
    bands.push({
      i, role: r.role, ongoing: r.ongoing, start: r.start, end: r.end,
      d: curve(top, "M") + " " + curve(bot, "L") + " Z",
      fill: color(r.role, "solid"),
      durTerms: (r.last as number) - r.s + 1,
      label,
    });
  });

  const seen: Record<string, boolean> = {};
  const legend: { role: string; fill: string }[] = [];
  z.slice().sort((a, b) => a.s - b.s).forEach((r) => {
    if (!seen[r.role]) { seen[r.role] = true; legend.push({ role: r.role, fill: color(r.role, "solid") }); }
  });

  return { W, H, ticks, bands, nowX: xFor(d.nowI), legend };
}

export interface FocusBand { d: string; fill: string; label: { x: number; y: number; text: string }; title: string }
export interface FocusModel {
  W: number; H: number; ticks: { x: number; label: string }[];
  bands: FocusBand[]; nowX: number | null;
  splitLabel: string; range: string;
}

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

export function computeFocus(roleObj: RoleStint, detail: RoleDetail, now: Date): FocusModel {
  const rn = roleObj.role;
  const terms = Object.keys(detail.byTerm).slice().sort((a, b) => (parseTerm(a) as number) - (parseTerm(b) as number));
  const N = terms.length;
  const items: { name: string; pos: Record<number, "x" | { top: number; bot: number }> }[] = [];
  const idx: Record<string, number> = {};
  terms.forEach((t, ti) => {
    detail.byTerm[t].forEach((it) => {
      if (idx[it] == null) { idx[it] = items.length; items.push({ name: it, pos: {} }); }
      items[idx[it]].pos[ti] = "x";
    });
  });
  const nItems = items.length;
  let maxPer = 0; terms.forEach((t) => { maxPer = Math.max(maxPer, detail.byTerm[t].length); });
  const TH = 36, GAP = 9, topPad = 26;
  const H = Math.max(240, topPad + maxPer * (TH + GAP) + 54);
  const padL = 26, padR = 26, colW = 172, W = Math.max(540, N * colW), plotW = W - padL - padR;
  const mid = topPad + (maxPer * (TH + GAP) - GAP) / 2;
  const xFor = (ti: number) => (N === 1 ? padL + plotW / 2 : padL + ti / (N - 1) * plotW);
  terms.forEach((_t, ti) => {
    const act = items.filter((it) => it.pos[ti]);
    const total = act.length * TH + (act.length - 1) * GAP;
    let y0 = mid - total / 2;
    act.forEach((it) => { it.pos[ti] = { top: y0, bot: y0 + TH }; y0 += TH + GAP; });
  });
  const ticks = terms.map((t, ti) => ({ x: xFor(ti), label: termLabel(parseTerm(t) as number) }));
  const halfcol = N > 1 ? (plotW / (N - 1)) * 0.42 : 36;
  const bands: FocusBand[] = [];
  items.forEach((it, i) => {
    const keys: number[] = [];
    for (const k in it.pos) if (typeof it.pos[k] === "object") keys.push(+k);
    keys.sort((a, b) => a - b);
    if (!keys.length) return;
    const col = itemColor(rn, i, nItems);
    const first = keys[0], last = keys[keys.length - 1];
    const pf = it.pos[first] as { top: number; bot: number }, pl = it.pos[last] as { top: number; bot: number };
    const cF = (pf.top + pf.bot) / 2, cL = (pl.top + pl.bot) / 2;
    const top: number[][] = [[xFor(first) - halfcol, cF]];
    keys.forEach((k) => { const p = it.pos[k] as { top: number; bot: number }; top.push([xFor(k), p.top]); });
    top.push([xFor(last) + halfcol, cL]);
    const bot: number[][] = [[xFor(last) + halfcol, cL]];
    keys.slice().reverse().forEach((k) => { const p = it.pos[k] as { top: number; bot: number }; bot.push([xFor(k), p.bot]); });
    bot.push([xFor(first) - halfcol, cF]);
    const lt = keys[Math.floor(keys.length / 2)], pm = it.pos[lt] as { top: number; bot: number };
    bands.push({
      d: curve(top, "M") + " " + curve(bot, "L") + " Z",
      fill: col,
      label: { x: xFor(lt), y: (pm.top + pm.bot) / 2 + 4, text: trunc(it.name, 20) },
      title: it.name + " · " + termLabel(parseTerm(terms[keys[0]]) as number),
    });
  });
  // NOW marker within the focus span
  const nowAx = dateAxis(now), a0 = parseTerm(terms[0]) as number, aN = parseTerm(terms[N - 1]) as number;
  let nowX: number | null = null;
  if (nowAx >= a0 && nowAx <= aN + 1) {
    if (N === 1) nowX = xFor(0) + halfcol * 0.6;
    else {
      for (let t2 = 0; t2 < N; t2++) {
        const at = parseTerm(terms[t2]) as number;
        const span = t2 < N - 1 ? (parseTerm(terms[t2 + 1]) as number) - at : 1;
        if (nowAx >= at && nowAx < at + span) {
          const frac = (nowAx - at) / span;
          const x2 = t2 < N - 1 ? xFor(t2 + 1) : xFor(t2) + halfcol;
          nowX = xFor(t2) + frac * (x2 - xFor(t2));
          break;
        }
      }
      if (nowX == null) nowX = xFor(N - 1);
    }
  }
  const splitLabel = detail.kind === "track" ? "track" : detail.kind === "event" ? "events" : "projects";
  const range = (roleObj.start || terms[0]) + (roleObj.end ? " → " + roleObj.end : " → present");
  return { W, H, ticks, bands, nowX, splitLabel, range };
}
