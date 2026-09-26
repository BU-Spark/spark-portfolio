"use client";
// "Add information" — the submitter side of the community-contribution flow.
//
// Rendered only for signed-in @bu.edu viewers (the server decides; this component
// is not mounted otherwise). It proposes, it never writes: POST /api/suggest stages
// the payload for admin review, and the copy says so plainly, because a form that
// looks like an edit box and silently queues is worse than one that admits it.
//
// Fields are ordered by what's actually missing on THIS project, and fields that
// already have content are hidden by default — a contributor filling a blank is the
// case worth optimising for, and showing six populated inputs invites overwriting
// things nobody asked to change.
//
// The form opens as a modal dialog (portalled to <body>) rather than expanding
// inline, so it is centred in the viewport instead of wherever the page ends.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { missingFields } from "@/lib/suggest";
import type { Project } from "@/lib/types";

const ACCENT = "#0fa392";

type Field = "blurb" | "repoUrl" | "prodUrl" | "tech" | "topics" | "contributorsNote" | "note";

const LABEL: Record<Field, string> = {
  blurb: "Description",
  repoUrl: "Code repository URL",
  prodUrl: "Live demo URL",
  tech: "Tech stack",
  topics: "Topics",
  contributorsNote: "Who worked on this",
  note: "Anything else",
};
const HINT: Partial<Record<Field, string>> = {
  tech: "Comma separated — React, Postgres, Python",
  contributorsNote: "Names, and GitHub handles if you have them. Reviewed by staff, never shown publicly.",
  note: "What's wrong or missing that isn't covered above.",
};

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export default function SuggestEdit({
  project,
  topicVocabulary,
}: {
  project: Project;
  topicVocabulary: string[];
}) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Partial<Record<Field, string>>>({});
  const [topics, setTopics] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const gaps = missingFields(project);
  const set = (f: Field) => (v: string) => setVals((p) => ({ ...p, [f]: v }));

  // Only offer a field if it is currently EMPTY. Filling blanks is the whole
  // purpose; proposing a replacement for existing content is an admin action.
  const offer: Field[] = [];
  if (!(project.blurb ?? "").trim()) offer.push("blurb");
  if (!project.repoUrl) offer.push("repoUrl");
  if (!project.prodUrl) offer.push("prodUrl");
  if (!(project.tech ?? []).length) offer.push("tech");
  if (!(project.topics ?? []).length) offer.push("topics");
  offer.push("contributorsNote", "note");

  // Modal plumbing: lock page scroll, move focus in, trap Tab, close on Escape, and
  // hand focus back on close — to the trigger, or to the thank-you card once a
  // successful send has replaced the trigger.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("input, textarea, [data-autofocus]")?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const els = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current ?? cardRef.current)?.focus();
    };
  }, [open]);

  // The success view swaps the focused "Send" button out; put focus on "Done".
  useEffect(() => {
    if (open && state === "done") {
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
  }, [open, state]);

  async function submit() {
    setState("sending");
    setError(null);
    const body: Record<string, unknown> = { projectId: project.id };
    for (const f of offer) {
      if (f === "topics") continue;
      const v = (vals[f] ?? "").trim();
      if (!v) continue;
      body[f] = f === "tech" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v;
    }
    if (topics.length) body.topics = topics;
    const res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Couldn't send that. Try again?");
      setState("idle");
      return;
    }
    setState("done");
  }

  const close = () => setOpen(false);

  const card =
    state === "done" ? (
      <div ref={cardRef} tabIndex={-1} className="sg-card" style={{ outline: "none" }}>
        <div>
          <strong style={{ fontFamily: "var(--display)", fontSize: 16 }}>
            Thanks — sent for review.
          </strong>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#55595e", lineHeight: 1.6 }}>
            The Spark! team will look at it. Nothing changes on the page until they accept it.
          </p>
        </div>
      </div>
    ) : (
      <div className="sg-card">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 16 }}>
            {gaps.length ? "Something missing here?" : "Know more about this project?"}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#55595e", lineHeight: 1.6 }}>
            {gaps.length
              ? `This project has no ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` (+${gaps.length - 3} more)` : ""}. If you worked on it, you can fill that in.`
              : "You can still suggest a correction or add who worked on it."}
          </p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          className="sg-btn sg-primary"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          Add information
        </button>
      </div>
    );

  const modal = (
    <div
      className="sg-overlay"
      onMouseDown={(e) => {
        // mousedown, not click: a text selection dragged out of a field and released
        // over the backdrop must not throw away the dialog.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        className="sg-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sg-head">
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} className="sg-title">
              Add information
            </h2>
            {state !== "done" && (
              <p className="sg-sub">
                Everything here is reviewed by the Spark! team before it appears. Fill in
                only what you know.
              </p>
            )}
          </div>
          <button type="button" className="sg-x" aria-label="Close" onClick={close}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {state === "done" ? (
          <>
            <div className="sg-body" style={{ textAlign: "center", paddingBottom: 22 }}>
              <div className="sg-check" aria-hidden>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </div>
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 18, color: "var(--ink)" }}>
                Thanks — sent for review.
              </div>
              <p style={{ margin: "8px auto 0", maxWidth: 380, fontSize: 14, color: "#55595e", lineHeight: 1.6 }}>
                The Spark! team will look at it. Nothing changes on the page until they accept it.
              </p>
            </div>
            <div className="sg-foot">
              <button type="button" data-autofocus className="sg-btn sg-primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sg-body">
              {offer.map((f) => (
                <div key={f} className="sg-field">
                  {f === "topics" ? (
                    <div className="sg-label" id={`sg-${f}-label`}>
                      {LABEL[f]}
                    </div>
                  ) : (
                    <label htmlFor={`sg-${f}`} className="sg-label">
                      {LABEL[f]}
                    </label>
                  )}
                  {f === "topics" ? (
                    <div
                      role="group"
                      aria-labelledby={`sg-${f}-label`}
                      style={{ display: "flex", flexWrap: "wrap", gap: 7 }}
                    >
                      {topicVocabulary.map((t) => {
                        const on = topics.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            aria-pressed={on}
                            className="sg-chip"
                            onClick={() =>
                              setTopics((p) => (on ? p.filter((x) => x !== t) : [...p, t]))
                            }
                            style={{
                              border: `1px solid ${on ? ACCENT : "var(--field)"}`,
                              background: on ? `${ACCENT}18` : "#fff",
                              color: on ? "#0b5c53" : "#55595e",
                            }}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  ) : f === "blurb" || f === "contributorsNote" || f === "note" ? (
                    <textarea
                      id={`sg-${f}`}
                      className="fld"
                      rows={f === "blurb" ? 5 : 3}
                      value={vals[f] ?? ""}
                      aria-describedby={HINT[f] ? `sg-${f}-hint` : undefined}
                      onChange={(e) => set(f)(e.target.value)}
                    />
                  ) : (
                    <input
                      id={`sg-${f}`}
                      className="fld"
                      type={f.endsWith("Url") ? "url" : "text"}
                      placeholder={f.endsWith("Url") ? "https://…" : undefined}
                      value={vals[f] ?? ""}
                      aria-describedby={HINT[f] ? `sg-${f}-hint` : undefined}
                      onChange={(e) => set(f)(e.target.value)}
                    />
                  )}
                  {HINT[f] && (
                    <div id={`sg-${f}-hint`} className="sg-hint">
                      {HINT[f]}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="sg-foot">
              {error && (
                <div role="alert" className="sg-error">
                  {error}
                </div>
              )}
              <button type="button" className="sg-btn sg-ghost" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="sg-btn sg-primary"
                onClick={submit}
                disabled={state === "sending"}
              >
                {state === "sending" ? "Sending…" : "Send for review"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="sg-wrap">
      <style>{CSS}</style>
      {card}
      {/* Portal to <body> so no page container can clip or out-stack the dialog. */}
      {open && createPortal(modal, document.body)}
    </div>
  );
}

// ponytail: component-scoped CSS in a <style> tag, because inline styles can't carry
// :focus, media queries or keyframes, and this component is the only consumer.
// .sg-wrap matches ProjectView's 760px column (and its mobile gutter) and pulls up
// into that column's bottom padding, so the card sits under the action buttons.
const CSS = `
.sg-wrap { max-width: 760px; margin: -46px auto 0; padding: 0 40px 80px; box-sizing: border-box; }
.sg-card { display: flex; align-items: center; gap: 20px; border: 1px solid var(--line); border-radius: 12px;
  padding: 18px 20px; background: linear-gradient(180deg, #f5fbfa, #fff); }
.sg-btn { padding: 10px 18px; border-radius: 8px; font-family: var(--body); font-size: 14px; font-weight: 600;
  cursor: pointer; white-space: nowrap; transition: background .15s, border-color .15s, box-shadow .15s, color .15s; }
.sg-btn:disabled { opacity: .65; cursor: default; }
.sg-btn:focus-visible, .sg-x:focus-visible, .sg-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px ${ACCENT}55; }
.sg-primary { border: 1px solid ${ACCENT}; background: ${ACCENT}; color: #05221e; }
.sg-primary:hover:not(:disabled) { background: #13b5a2; border-color: #13b5a2; }
.sg-ghost { border: 1px solid var(--field); background: #fff; color: #55595e; }
.sg-ghost:hover { border-color: #bdbdbd; color: var(--ink); }
.sg-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(14, 18, 17, 0.45); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  animation: sgFade .16s ease-out; }
.sg-panel { width: 100%; max-width: 560px; max-height: calc(100dvh - 48px); display: flex; flex-direction: column;
  background: #fff; border-radius: 14px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(14, 18, 17, 0.22), 0 2px 8px rgba(14, 18, 17, 0.08); animation: sgPop .18s ease-out; }
.sg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 24px 28px 18px;
  border-bottom: 1px solid var(--rowsep); }
.sg-title { margin: 0; font-family: var(--display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
.sg-sub { margin: 6px 0 0; font-size: 13.5px; line-height: 1.6; color: #6a6f74; }
.sg-x { flex: none; display: grid; place-items: center; width: 34px; height: 34px; margin: -5px -9px 0 0; border: 0;
  border-radius: 8px; background: transparent; color: #6a6f74; cursor: pointer; }
.sg-x:hover { background: #f1f3f2; color: var(--ink); }
.sg-body { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 22px 28px 4px; }
.sg-field { margin-bottom: 20px; }
.sg-label { display: block; margin-bottom: 7px; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.1em;
  text-transform: uppercase; color: #7d8287; }
.sg-hint { margin-top: 6px; font-size: 12.5px; line-height: 1.5; color: #8a8f94; }
.sg-panel .fld { transition: border-color .15s, box-shadow .15s; }
.sg-panel .fld:focus { border-color: ${ACCENT}; box-shadow: 0 0 0 3px ${ACCENT}26; }
.sg-panel textarea.fld { min-height: 88px; }
.sg-chip { font-size: 12.5px; padding: 5px 11px; border-radius: 999px; cursor: pointer; font-family: var(--body); }
.sg-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; padding: 16px 28px 20px;
  border-top: 1px solid var(--rowsep); background: #fafbfb; }
.sg-error { flex-basis: 100%; font-size: 13.5px; color: #991b1b; background: #fdf0ef; border: 1px solid #f5d3d0;
  border-radius: 8px; padding: 9px 12px; }
.sg-check { display: grid; place-items: center; width: 52px; height: 52px; margin: 6px auto 14px; border-radius: 50%;
  background: ${ACCENT}1f; color: #0a7d70; }
@keyframes sgFade { from { opacity: 0; } }
@keyframes sgPop { from { opacity: 0; transform: translateY(8px) scale(.985); } }
@keyframes sgUp { from { opacity: 0; transform: translateY(24px); } }
@media (max-width: 600px) {
  .sg-wrap { margin-top: -30px; padding: 0 16px 64px; }
  .sg-card { flex-direction: column; align-items: stretch; gap: 14px; }
  .sg-overlay { align-items: flex-end; padding: 0; }
  .sg-panel { max-width: none; max-height: 92dvh; border-radius: 16px 16px 0 0; animation-name: sgUp; }
  .sg-head { padding: 20px 20px 16px; }
  .sg-body { padding: 18px 20px 4px; }
  .sg-foot { padding: 14px 20px calc(16px + env(safe-area-inset-bottom)); }
  .sg-foot .sg-btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .sg-overlay, .sg-panel { animation: none; } }
`;
