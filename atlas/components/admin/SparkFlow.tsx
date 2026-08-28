"use client";
// SparkFlow — the role-journey streamgraph (React/SVG, no innerHTML).
// Each role is a flowing ribbon along an academic-term axis; concurrency swells
// the river. Click a ribbon (or legend chip) to zoom into that role — it splits
// into per-term sub-ribbons (one band per project/track/event). Geometry comes
// from sparkFlowMath.ts (a faithful port of the handoff engine's math).
import { useState } from "react";
import {
  computeStream, computeFocus, rangeTxt, color,
  type RoleStint, type DetailMap,
} from "./sparkFlowMath";

export default function SparkFlow({
  roles, detail, now, height = 300, legend = true,
}: {
  roles: RoleStint[];
  detail?: DetailMap;
  now: Date;
  height?: number;
  legend?: boolean;
}) {
  const [focusRole, setFocusRole] = useState<string | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  if (!roles.length) {
    return <div style={{ padding: 30, color: "var(--ink-4)" }}>No roles recorded yet.</div>;
  }

  // ── Focus (zoom) view ──
  if (focusRole && detail && detail[focusRole]) {
    const roleObj = roles.find((r) => r.role === focusRole) || { role: focusRole, start: "" };
    const f = computeFocus(roleObj, detail[focusRole], now);
    const sc = color(focusRole, "solid"), dp = color(focusRole, "deep");
    return (
      <div style={{ animation: "sffz .32s cubic-bezier(.22,1,.36,1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
          <button className="btn-sm" onClick={() => setFocusRole(null)}>← Back to journey</button>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--display)", fontSize: 15, flexWrap: "wrap" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: sc }} />
            <b style={{ color: dp }}>{focusRole}</b>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)", fontWeight: 400 }}>{f.range}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 400, color: "var(--ink-4)" }}>
              split by {f.splitLabel} · each band is one item that semester
            </span>
          </div>
        </div>
        <div style={{ overflowX: "auto", paddingBottom: 2 }}>
          <svg viewBox={`0 0 ${f.W} ${f.H}`} width={f.W} height={f.H} style={{ minWidth: "100%" }}>
            {f.ticks.map((t, i) => (
              <g key={i}>
                <line x1={t.x} y1={26} x2={t.x} y2={f.H - 26} stroke="#eef1ee" strokeWidth={1} />
                <text x={t.x} y={f.H - 8} textAnchor="middle" fontFamily="var(--mono)" fontSize={10.5} fill="#93a09b">{t.label}</text>
              </g>
            ))}
            {f.nowX != null && (
              <g>
                <line x1={f.nowX} y1={20} x2={f.nowX} y2={f.H - 26} stroke="#0a8576" strokeWidth={2} strokeDasharray="3 3" />
                <circle cx={f.nowX} cy={20} r={3.5} fill="#1fd6bb" />
                <text x={f.nowX + 6} y={23} fontFamily="var(--mono)" fontSize={9} fontWeight={600} fill="#0a8576">NOW</text>
              </g>
            )}
            {f.bands.map((b, i) => (
              <path key={i} d={b.d} fill={b.fill} fillOpacity={0.9} stroke="#fff" strokeWidth={1.6}>
                <title>{b.title}</title>
              </path>
            ))}
            {f.bands.map((b, i) => (
              <text key={`l${i}`} x={b.label.x} y={b.label.y} textAnchor="middle" fontFamily="var(--display)" fontWeight={600} fontSize={11.5} fill="#fff" pointerEvents="none">{b.label.text}</text>
            ))}
          </svg>
        </div>
      </div>
    );
  }

  // ── Main streamgraph ──
  const m = computeStream(roles, now, height);
  const hasDetail = (role: string) => !!(detail && detail[role]);

  return (
    <div>
      <div style={{ position: "relative" }}>
        <div style={{ overflowX: "auto", paddingBottom: 2 }}>
          <svg viewBox={`0 0 ${m.W} ${m.H}`} width={m.W} height={m.H} style={{ minWidth: "100%" }}>
            <defs>
              {m.bands.map((b) => (
                <linearGradient key={b.i} id={`sf${b.i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={b.fill} stopOpacity={0.96} />
                  <stop offset="1" stopColor={b.fill} stopOpacity={0.74} />
                </linearGradient>
              ))}
            </defs>
            {m.ticks.map((t, i) => (
              <g key={i}>
                <line x1={t.x} y1={18} x2={t.x} y2={m.H - 22} stroke="#edf0ec" strokeWidth={1} />
                <text x={t.x} y={m.H - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize={10} fill="#93a09b">{t.label}</text>
              </g>
            ))}
            {m.bands.map((b) => {
              const dim = hover != null && hover.i !== b.i;
              return (
                <path
                  key={b.i}
                  d={b.d}
                  fill={`url(#sf${b.i})`}
                  stroke="#fff"
                  strokeWidth={1.5}
                  style={{
                    cursor: "pointer",
                    opacity: dim ? 0.2 : 1,
                    filter: hover?.i === b.i ? "brightness(1.06)" : undefined,
                    transition: "opacity .18s, filter .12s",
                  }}
                  onMouseMove={(e) => {
                    const box = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                    setHover({ i: b.i, x: e.clientX - box.left, y: e.clientY - box.top });
                  }}
                  onMouseLeave={() => setHover((h) => (h?.i === b.i ? null : h))}
                  onClick={() => hasDetail(b.role) && setFocusRole(b.role)}
                >
                  {!hasDetail(b.role) && <title>{b.role} — {rangeTxt(b)}</title>}
                </path>
              );
            })}
            {m.bands.map((b) => b.label && (
              <text key={`l${b.i}`} x={b.label.x} y={b.label.y} textAnchor="middle" fontFamily="var(--display)" fontWeight={600} fontSize={12.5} fill="#fff" pointerEvents="none">{b.role}</text>
            ))}
            <g>
              <line x1={m.nowX} y1={12} x2={m.nowX} y2={m.H - 22} stroke="#0a8576" strokeWidth={2} strokeDasharray="3 3" />
              <circle cx={m.nowX} cy={12} r={3.5} fill="#1fd6bb" />
              <text x={m.nowX + 6} y={15} fontFamily="var(--mono)" fontSize={9} fontWeight={600} fill="#0a8576">NOW</text>
            </g>
          </svg>
        </div>
        {hover && (() => {
          const b = m.bands.find((x) => x.i === hover.i)!;
          return (
            <div style={{
              position: "absolute", left: Math.min(m.W - 160, Math.max(8, hover.x + 12)), top: hover.y - 10,
              pointerEvents: "none", background: "#0b0e0d", color: "#fff", borderRadius: 9, padding: "8px 11px",
              boxShadow: "0 10px 26px -8px rgba(0,0,0,.4)", zIndex: 5, display: "flex", flexDirection: "column", gap: 2, minWidth: 120,
            }}>
              <b style={{ fontFamily: "var(--display)", fontSize: 13 }}>{b.role}</b>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#9fe9dd" }}>{rangeTxt(b)}</span>
              <i style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 9.5, color: "#8a958f" }}>
                {b.durTerms} term{b.durTerms > 1 ? "s" : ""}{b.ongoing ? " · ongoing" : ""}{hasDetail(b.role) ? " · click for detail" : ""}
              </i>
            </div>
          );
        })()}
      </div>

      {legend && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          {m.legend.map((l) => (
            <button
              key={l.role}
              onClick={() => hasDetail(l.role) && setFocusRole(l.role)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ink-2)",
                cursor: hasDetail(l.role) ? "pointer" : "default", padding: "4px 9px", borderRadius: 8,
                border: "1px solid transparent", background: "none",
              }}
            >
              <span style={{ width: 11, height: 11, borderRadius: 3, background: l.fill }} />
              {l.role}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
