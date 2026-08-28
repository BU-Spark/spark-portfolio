"use client";
// Admin widget on the edit page: generate a screenshot-upload magic link for this
// project, optionally email it (if Resend is configured), copy it, and see the
// links already outstanding for the project. The link is the delivery mechanism —
// copy it and send it however you reach the PM.
import { useCallback, useEffect, useState } from "react";

const ACCENT = "#0fa392";

interface ExistingReq {
  token: string;
  recipient: string | null;
  status: "open" | "submitted" | "approved";
  createdAt: string;
  expiresAt: string;
}

const STATUS_LABEL: Record<ExistingReq["status"], string> = {
  open: "Open",
  submitted: "Awaiting review",
  approved: "Approved",
};

export default function RequestUpload({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; emailed: boolean; emailConfigured: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingReq[]>([]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const loadExisting = useCallback(async () => {
    const res = await fetch(`/api/upload-requests?projectId=${encodeURIComponent(projectId)}`);
    if (res.ok) {
      const { requests } = await res.json();
      setExisting(requests ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/upload-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim() || undefined }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || "Could not generate link.");
      }
      const data = await res.json();
      setResult({ url: data.url, emailed: data.emailed, emailConfigured: data.emailConfigured });
      await loadExisting();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate link.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select and copy the link manually.");
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e6e6e6",
        borderRadius: 10,
        padding: "18px 18px",
        background: "#fbfbfb",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#8a8a8a",
          marginBottom: 8,
        }}
      >
        Request screenshots from a PM
      </div>
      <p style={{ fontSize: 12.5, color: "#9a9a9a", margin: "0 0 12px", lineHeight: 1.5 }}>
        Generate a no-login link the project team can use to upload up to 4 screenshots. Uploads
        come back here for your review before they go live. The link works for anyone you forward
        it to and expires in 14 days.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          className="fld"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="PM email (optional — for your records / auto-send)"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          style={{
            whiteSpace: "nowrap",
            padding: "0 16px",
            border: "none",
            borderRadius: 7,
            cursor: busy ? "not-allowed" : "pointer",
            background: busy ? "#cfcfcf" : `color-mix(in oklab, ${ACCENT} 88%, #000)`,
            color: "#fff",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {busy ? "Generating…" : "Generate link"}
        </button>
      </div>

      {error && <div style={{ color: "#b3261e", fontSize: 12.5, marginTop: 8 }}>{error}</div>}

      {result && (
        <div
          style={{
            marginTop: 12,
            background: "#fff",
            border: `1px solid color-mix(in oklab, ${ACCENT} 30%, #ddd)`,
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              readOnly
              value={result.url}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                border: "1px solid #e0e0e0",
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                color: "#16191c",
                background: "#fafafa",
              }}
            />
            <button
              type="button"
              onClick={() => copy(result.url)}
              style={{
                padding: "8px 14px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: ACCENT,
                color: "#fff",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#6a6f74", marginTop: 8 }}>
            {result.emailed
              ? "Emailed to the PM. Copy the link too in case it lands in spam."
              : result.emailConfigured
                ? "Couldn't auto-send — copy the link and send it manually."
                : "Copy this link and send it to the PM (email auto-send isn't set up yet)."}
          </div>
        </div>
      )}

      {existing.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "#9a9a9a", marginBottom: 6 }}>
            Existing links for this project
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {existing.map((r) => (
              <div
                key={r.token}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12.5,
                  color: "#55595e",
                  borderTop: "1px solid #eee",
                  paddingTop: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background:
                      r.status === "submitted"
                        ? "color-mix(in oklab, #a86700 16%, #fff)"
                        : r.status === "approved"
                          ? `color-mix(in oklab, ${ACCENT} 16%, #fff)`
                          : "#eee",
                    color:
                      r.status === "submitted"
                        ? "#a86700"
                        : r.status === "approved"
                          ? `color-mix(in oklab, ${ACCENT} 72%, #000)`
                          : "#6a6f74",
                  }}
                >
                  {STATUS_LABEL[r.status]}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.recipient || "no email"} · expires {new Date(r.expiresAt).toLocaleDateString()}
                </span>
                {r.status !== "approved" && (
                  <button
                    type="button"
                    onClick={() => copy(`${origin}/contribute/${r.token}`)}
                    style={{
                      border: "1px solid #d8d8d8",
                      background: "#fff",
                      borderRadius: 5,
                      padding: "3px 9px",
                      fontSize: 11.5,
                      cursor: "pointer",
                      color: "#55595e",
                    }}
                  >
                    Copy link
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
