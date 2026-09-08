"use client";
// Circular "process wheel" dashboard hero for /admin — recreated from the Claude
// Design circular-infographic handoff, with the BU Spark! logo at center (instead
// of the spec's silver disc) and each wedge wired to an admin section. Like the
// reference, thin elbow connector lines run from each wedge out to a numbered
// callout, and the six callouts are sparsely/asymmetrically placed (not rigid
// columns). Three stacked layers: connectors (z1) · wheel (z2) · callouts (z3).
// Everything shares one 1000×620 coordinate basis so connectors align at any size.
// Honors prefers-reduced-motion (no hover lift; opacity only).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { step as segmentStep, prevIndex } from "@/lib/wheel";

// ── wheel geometry (380×380 viewBox; center 190,190; inner 84; ring 149) ──
const C = 190;
const R_INNER = 84;
const R_RING = 149;
const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
};
function wedge(r0: number, r1: number, a0: number, a1: number): string {
  const [x1, y1] = polar(r1, a0), [x2, y2] = polar(r1, a1);
  const [x3, y3] = polar(r0, a1), [x4, y4] = polar(r0, a0);
  return `M ${x1} ${y1} A ${r1} ${r1} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${r0} ${r0} 0 0 0 ${x4} ${y4} Z`;
}
function ringArc(r: number, a0: number, a1: number): string {
  const [x1, y1] = polar(r, a0), [x2, y2] = polar(r, a1);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

// ── overlay coordinate basis (1000×620); wheel is 46% wide → 460 units, centered ──
const VBW = 1000, VBH = 620, OX = 500, OY = 310;
const SCALE = 460 / 380; // wheel display scale within the overlay basis
const R_START = R_RING * SCALE + 4; // connector start radius (just outside the ring)
const opolar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [OX + r * Math.sin(a), OY - r * Math.cos(a)] as const;
};

// Per-segment callout anchor (dot) points in overlay coords — deliberately
// asymmetric/sparse, like the reference.
const ANCHOR: Record<number, readonly [number, number]> = {
  0: [694, 138], // Projects   — top-right
  1: [772, 300], // People     — right-mid
  2: [704, 488], // Inbox      — bottom-right
  3: [300, 476], // Uploads    — bottom-left
  4: [228, 300], // Bulk       — left-mid
  5: [322, 150], // Settings   — top-left
};
const RIGHT_SIDE = new Set([0, 1, 2]); // callouts that sit to the right of the wheel

export interface WheelSegment {
  key: string;
  title: string;
  href: string;
  count: number | null;
  descriptor: string;
  solidR: number;
  from: string;
  to: string;
  icon: React.ReactNode;
}

export default function DashboardWheel({
  segments,
  loading,
}: {
  segments: WheelSegment[];
  loading?: boolean;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);

  // Geometry derives from the ACTUAL segment count. It used to hardcode 6 — 60° per
  // wedge, and `segments[(i + 5) % 6]` to find the previous one — which was true only
  // for a super admin. app/admin/page.tsx filters the Settings segment out for
  // non-supers, so they got 5 segments, `segments[5]` was undefined, and reading
  // `.solidR` off it threw:
  //
  //   TypeError: Cannot read properties of undefined (reading 'solidR')
  //
  // That 500'd /admin for every non-super admin — 6 of 8 accounts — while working
  // fine for the two supers, which is exactly the kind of bug that looks like
  // "works on my machine".
  const N = segments.length;
  const STEP = segmentStep(N);
  // Nothing to draw, and dividing by zero would produce NaN coordinates that render
  // as an invisible-but-present SVG. Bail explicitly instead.
  if (!N) return null;

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 1540, margin: "0 auto", aspectRatio: `${VBW} / ${VBH}` }}>
      {/* ── layer 1: connector elbows ── */}
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1, pointerEvents: "none", overflow: "visible" }}
        aria-hidden
      >
        {segments.map((s, i) => {
          const mid = i * STEP + STEP / 2;
          const [sx, sy] = opolar(R_START, mid);
          const [ax, ay] = ANCHOR[i];
          const on = hover === null || hover === i;
          // elbow: vertical from the wheel to the callout's row, then horizontal to the dot
          return (
            <g key={`con-${i}`} opacity={on ? 1 : 0.25} style={{ transition: "opacity .15s" }}>
              <polyline points={`${sx},${sy} ${sx},${ay} ${ax},${ay}`} fill="none" stroke={s.to} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={ax} cy={ay} r={3.6} fill={s.to} />
            </g>
          );
        })}
      </svg>

      {/* ── layer 2: the wheel ── */}
      <svg
        viewBox="0 0 380 380"
        style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "46%", height: "auto", zIndex: 2, overflow: "visible", pointerEvents: "auto" }}
        role="group"
        aria-label="Admin sections"
      >
        <defs>
          {segments.map((s, i) => {
            const mid = i * STEP + STEP / 2;
            const [gx1, gy1] = polar(R_INNER, mid);
            const [gx2, gy2] = polar(R_RING, mid);
            return (
              <linearGradient key={s.key} id={`wseg-${i}`} gradientUnits="userSpaceOnUse" x1={gx1} y1={gy1} x2={gx2} y2={gy2}>
                <stop offset="0" stopColor={s.from} />
                <stop offset="1" stopColor={s.to} />
              </linearGradient>
            );
          })}
        </defs>

        {/* ghost ring arcs */}
        {segments.map((_s, i) => (
          <path key={`ring-${i}`} d={ringArc(R_RING, i * STEP + 4, (i + 1) * STEP - 4)} fill="none" stroke={`url(#wseg-${i})`} strokeWidth={2.6} strokeLinecap="round" opacity={hover === null || hover === i ? 1 : 0.4} style={{ transition: "opacity .15s" }} />
        ))}

        {/* clickable wedges */}
        {segments.map((s, i) => {
          const on = hover === i;
          const [ix, iy] = polar((R_INNER + s.solidR) / 2, i * STEP + STEP / 2);
          return (
            <g
              key={s.key}
              role="link"
              aria-label={`${s.title}${s.count != null ? ` — ${s.count}` : ""}`}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
              onClick={() => router.push(s.href)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(s.href); } }}
              style={{ cursor: "pointer", outline: "none" }}
            >
              <path d={wedge(R_INNER, s.solidR, i * STEP, (i + 1) * STEP)} fill={`url(#wseg-${i})`} opacity={hover === null || on ? 1 : 0.55} style={{ transition: "opacity .15s, filter .15s", filter: on ? "brightness(1.07)" : undefined }} />
              <g transform={`translate(${ix} ${iy})`} stroke="#fff" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{s.icon}</g>
            </g>
          );
        })}

        {/* white separators */}
        {segments.map((s, i) => {
          const prev = segments[prevIndex(i, N)].solidR;
          const outer = Math.max(s.solidR, prev);
          const [x1, y1] = polar(R_INNER, i * STEP);
          const [x2, y2] = polar(outer, i * STEP);
          return <line key={`sep-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={2.6} strokeLinecap="round" />;
        })}

        {/* center: Spark logo fills the disc (replaces the silver disc) */}
        <circle cx={C} cy={C} r={83} fill="#fff" />
        <circle cx={C} cy={C} r={83} fill="none" stroke="#e6e9ed" strokeWidth={1.2} />
        <image href="/spark-logo.png" x={C - 80} y={C - 80} width={160} height={160} preserveAspectRatio="xMidYMid meet" />
      </svg>

      {/* ── layer 3: callouts (anchored to the connector dots, sparsely placed) ── */}
      {segments.map((s, i) => {
        const [ax, ay] = ANCHOR[i];
        const right = RIGHT_SIDE.has(i);
        const on = hover === i;
        const pos: React.CSSProperties = right
          ? { left: `${(ax / VBW) * 100}%`, paddingLeft: 14 }
          : { right: `${((VBW - ax) / VBW) * 100}%`, paddingRight: 14 };
        return (
          <Link
            key={`co-${i}`}
            href={s.href}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            style={{
              position: "absolute",
              top: `${(ay / VBH) * 100}%`,
              transform: "translateY(-50%)",
              width: 224,
              zIndex: 3,
              pointerEvents: "auto",
              textDecoration: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: right ? "flex-start" : "flex-end",
              gap: 2,
              padding: "8px 4px",
              borderRadius: 12,
              background: on ? `color-mix(in oklab, ${s.to} 8%, #fff)` : "transparent",
              transition: "background .15s",
              ...pos,
            }}
          >
            <div style={{ display: "flex", flexDirection: right ? "row" : "row-reverse", alignItems: "center", gap: 9 }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${s.from}, ${s.to})`, color: "#fff", fontFamily: "var(--display)", fontWeight: 800, fontSize: 13, boxShadow: `0 0 0 4px color-mix(in oklab, ${s.to} 15%, transparent)` }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 15.5, letterSpacing: "0.01em", color: s.to }}>{s.title}</span>
            </div>
            <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 34, lineHeight: 1.1, color: "var(--ink)", textAlign: right ? "left" : "right", width: "100%" }}>
              {s.count != null ? (loading ? "·" : s.count) : <span style={{ fontSize: 15, fontWeight: 600, color: "var(--sec)" }}>{s.descriptor}</span>}
            </div>
            {s.count != null && (
              <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--faint)", textAlign: right ? "left" : "right", width: "100%" }}>{s.descriptor}</div>
            )}
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: s.to, marginTop: 2, opacity: on ? 1 : 0.6, transition: "opacity .15s", textAlign: right ? "left" : "right", width: "100%" }}>View →</div>
          </Link>
        );
      })}
    </div>
  );
}
