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
import { useState } from "react";
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

  if (state === "done") {
    return (
      <div style={box}>
        <strong style={{ fontFamily: "var(--display)" }}>Thanks — sent for review.</strong>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "#55595e", lineHeight: 1.6 }}>
          The Spark! team will look at it. Nothing changes on the page until they accept it.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div style={box}>
        <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 16 }}>
          {gaps.length ? "Something missing here?" : "Know more about this project?"}
        </div>
        <p style={{ margin: "6px 0 12px", fontSize: 14, color: "#55595e", lineHeight: 1.6 }}>
          {gaps.length
            ? `This project has no ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` (+${gaps.length - 3} more)` : ""}. If you worked on it, you can fill that in.`
            : "You can still suggest a correction or add who worked on it."}
        </p>
        <button type="button" onClick={() => setOpen(true)} style={primaryBtn}>
          Add information
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
        Add information
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "#55595e", lineHeight: 1.6 }}>
        Everything here is reviewed by the Spark! team before it appears. Fill in only
        what you know.
      </p>

      {offer.map((f) => (
        <div key={f} style={{ marginBottom: 14 }}>
          <label
            htmlFor={`sg-${f}`}
            style={{
              display: "block",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#9a9a9a",
              marginBottom: 6,
            }}
          >
            {LABEL[f]}
          </label>
          {f === "topics" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {topicVocabulary.map((t) => {
                const on = topics.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setTopics((p) => (on ? p.filter((x) => x !== t) : [...p, t]))
                    }
                    style={{
                      fontSize: 12.5,
                      padding: "5px 10px",
                      borderRadius: 999,
                      cursor: "pointer",
                      border: `1px solid ${on ? ACCENT : "var(--field)"}`,
                      background: on ? `${ACCENT}18` : "#fff",
                      color: on ? "#0b5c53" : "#55595e",
                      fontFamily: "var(--body)",
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
              onChange={(e) => set(f)(e.target.value)}
              style={{ width: "100%", resize: "vertical" }}
            />
          ) : (
            <input
              id={`sg-${f}`}
              className="fld"
              type={f.endsWith("Url") ? "url" : "text"}
              placeholder={f.endsWith("Url") ? "https://…" : undefined}
              value={vals[f] ?? ""}
              onChange={(e) => set(f)(e.target.value)}
              style={{ width: "100%" }}
            />
          )}
          {HINT[f] && (
            <div style={{ fontSize: 12, color: "#8a8f94", marginTop: 4 }}>{HINT[f]}</div>
          )}
        </div>
      ))}

      {error && (
        <div role="alert" style={{ fontSize: 13.5, color: "#991b1b", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" onClick={submit} disabled={state === "sending"} style={primaryBtn}>
          {state === "sending" ? "Sending…" : "Send for review"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ ...primaryBtn, background: "#fff", color: "#55595e", border: "1px solid var(--field)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const box: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "18px 20px",
  background: "#fff",
  marginTop: 34,
};
const primaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: `1px solid ${ACCENT}`,
  background: ACCENT,
  color: "#05221e",
  fontFamily: "var(--body)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
