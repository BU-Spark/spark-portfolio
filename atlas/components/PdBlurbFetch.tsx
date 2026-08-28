"use client";
// Admin-only "paste the doc URL → auto-fill the blurb" control.
//
// Why this exists: the PD summaries live in bu.edu-restricted Google Docs. Our
// server has no BU Google session, so it can't read them (that's why the bulk
// backfill goes through the Apps Script, which runs AS a BU user). But the admin
// IS signed into a BU Google account in their browser — so we reproduce the
// Apps Script trick client-side: ask Google for a ONE-TIME Drive-read token via
// Google Identity Services, fetch the doc's plain text directly from Google AS
// the admin, then run the same extractPdBlurb() parser locally.
//
// The token is ephemeral (in memory, ~1hr, reused within the session) and NEVER
// touches our server or DB. Only the final blurb text is saved, via the normal
// form save — exactly as if the admin had typed it. The Drive scope is requested
// with incremental consent: the "view your Google Docs" prompt appears only when
// an admin first clicks Fetch, not at login (login stays email/profile only).
import { useCallback, useRef, useState } from "react";
import { extractPdBlurb } from "@/lib/gdocs";
import { parseTechStack, type TechParse } from "@/lib/tech";

// drive.readonly lets us hit the Drive "export to text/plain" endpoint for any
// doc the signed-in user can already open. (drive.file is too narrow — it only
// covers files the app itself created/opened via the Picker.) On an *internal*
// Workspace OAuth app, restricted scopes like this skip Google's verification.
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GSI_SRC = "https://accounts.google.com/gsi/client";

// A Google Doc URL is docs.google.com/document/d/<FILE_ID>/edit. Pull the ID.
function docIdFromUrl(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  // Bare ID pasted directly.
  const bare = url.trim();
  if (/^[a-zA-Z0-9_-]{20,}$/.test(bare)) return bare;
  return null;
}

// "Red" = high red, low green/blue. Catches #ff0000, #cc0000, #e60000, Google
// red #ea4335, and rgb() forms. Leaves blue links + black body untouched.
// NOTE: keep this threshold in sync with the Apps Script (scripts/pd-sync.gs).
function colorIsRed(c: string): boolean {
  if (!c) return false;
  let r: number, g: number, b: number;
  const rgb = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    [r, g, b] = [+rgb[1], +rgb[2], +rgb[3]];
  } else {
    const hex = c.replace(/[^0-9a-f]/gi, "");
    if (hex.length < 6) return false;
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  return r >= 0x99 && g <= 0x66 && b <= 0x66;
}

// Turn the doc's exported HTML into plain text for extractPdBlurb. Each block
// (paragraph / list item / heading) becomes its own line, list items get a "* "
// prefix (cleanBlurb later renders "•"). When dropRed is set, a block whose
// MAJORITY of characters are red is dropped entirely — red editorial notes often
// wrap a blue hyperlink, so dropping only the red runs would orphan the link
// text. DOMParser does not execute scripts; we only read text + inline color.
function htmlToBlurbText(html: string, dropRed: boolean): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = doc.body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6");
  const lines: string[] = [];
  blocks.forEach((el) => {
    const text = (el.textContent || "").replace(/ /g, " ").trim();
    if (dropRed && text) {
      let redLen = 0;
      el.querySelectorAll<HTMLElement>("[style]").forEach((s) => {
        if (colorIsRed(s.style.color)) redLen += (s.textContent || "").length;
      });
      const total = (el.textContent || "").length || 1;
      if (redLen / total > 0.5) return; // skip majority-red block
    }
    if (!text) {
      lines.push(""); // preserve paragraph spacing
      return;
    }
    lines.push((el.tagName === "LI" ? "* " : "") + text);
  });
  return lines.join("\n");
}

// Find the "Tech Stack / Design system Used" row in the doc's tables and return
// its value cell as text ("* "-prefixed list items), matching the Apps Script
// extractor. The server-shared parseTechStack() then derives the tags.
function techCellFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const LABEL = /tech stack|design system|preferred tech/i;
  const rows = doc.body.querySelectorAll("tr");
  for (const row of Array.from(rows)) {
    const cells = row.querySelectorAll("td, th");
    if (cells.length < 2) continue;
    if (!LABEL.test(cells[0].textContent || "")) continue;
    const value = cells[1];
    const lines: string[] = [];
    const blocks = value.querySelectorAll("p, li");
    const els = blocks.length ? Array.from(blocks) : [value];
    els.forEach((el) => {
      const text = (el.textContent || "").replace(/ /g, " ").trim();
      if (text) lines.push((el.tagName === "LI" ? "* " : "") + text);
    });
    return lines.join("\n");
  }
  return "";
}

// GIS token-client types are loose; declare just what we touch.
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
  callback: (resp: { access_token?: string; error?: string }) => void;
}
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

// Load the GIS script once; resolve when window.google.accounts.oauth2 is ready.
let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gsiPromise = null;
      reject(new Error("Failed to load Google Identity Services."));
    };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; msg: string }
  | { kind: "warn"; msg: string }
  | { kind: "err"; msg: string };

export default function PdBlurbFetch({
  onFetched,
  initialUrl = "",
  onUrlChange,
  accent = "#0fa392",
}: {
  // Called with the extracted blurb (may be "" if no heading found), the full
  // doc text, and the parsed Tech Stack cell — so the parent can fill the
  // textarea + tech tags for the admin to confirm.
  onFetched: (blurb: string, fullText: string, tech?: TechParse) => void;
  // Seed the input with the project's stored PD doc link (so the admin can
  // re-pull in one click), and lift any edits back so the link is saved.
  initialUrl?: string;
  onUrlChange?: (url: string) => void;
  accent?: string;
}) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const tokenRef = useRef<string | null>(null);
  const clientRef = useRef<TokenClient | null>(null);

  // Resolve an access token: reuse the one in memory, else run the GIS popup.
  const getToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    await loadGsi();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) throw new Error("Google Identity Services unavailable.");
    return new Promise<string>((resolve, reject) => {
      if (!clientRef.current) {
        clientRef.current = oauth2.initTokenClient({
          client_id: clientId as string,
          scope: SCOPE,
          callback: () => {}, // replaced per-request below
        });
      }
      clientRef.current.callback = (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || "Authorization was cancelled."));
          return;
        }
        tokenRef.current = resp.access_token;
        resolve(resp.access_token);
      };
      // No prompt param → Google shows consent only the first time, then silent.
      clientRef.current.requestAccessToken();
    });
  }, [clientId]);

  const fetchDoc = useCallback(async () => {
    const id = docIdFromUrl(url);
    if (!id) {
      setStatus({
        kind: "err",
        msg: "That doesn't look like a Google Doc URL. Paste the full docs.google.com/document/d/… link.",
      });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      let token = await getToken();
      // Export as HTML (not text/plain) so we can SEE color and drop red
      // editorial notes. Still within drive.readonly — no new consent.
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/html`;
      let res = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // A stale/expired token reads as 401 — drop it and retry once with a fresh
      // consent/token round-trip.
      if (res.status === 401) {
        tokenRef.current = null;
        token = await getToken();
        res = await fetch(exportUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      if (res.status === 403 || res.status === 404) {
        setStatus({
          kind: "err",
          msg: "Couldn't open that doc with your Google account — check you have access to it (and that it's a Google Doc, not a PDF/Word file).",
        });
        return;
      }
      if (!res.ok) {
        setStatus({ kind: "err", msg: `Google returned ${res.status}. Try again.` });
        return;
      }
      const html = await res.text();
      // Reconstruct plain text two ways: with majority-red paragraphs dropped
      // (editorial notes), and without (fallback). Try the stripped version
      // first; if it yields no blurb — e.g. the doc colored its own heading red —
      // fall back to the un-stripped text so we're never worse than before.
      const stripped = htmlToBlurbText(html, true);
      const full = htmlToBlurbText(html, false);
      let blurb = extractPdBlurb(stripped);
      if (!blurb) blurb = extractPdBlurb(full);
      const text = stripped || full;
      const tech = parseTechStack(techCellFromHtml(html));
      onFetched(blurb || text.trim(), text, tech);
      setStatus(
        blurb
          ? { kind: "ok", msg: "Fetched — review and edit the description below, then save." }
          : {
              kind: "warn",
              msg: "Opened the doc but couldn't auto-find a “Project Description” section. The full text was pulled in — trim it down below.",
            }
      );
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Something went wrong fetching the doc.",
      });
    }
  }, [url, getToken, onFetched]);

  if (!clientId) {
    return (
      <div style={{ fontSize: 12.5, color: "#9a9a9a", marginBottom: 10 }}>
        Auto-fetch from a doc URL is unavailable — set{" "}
        <code style={{ fontFamily: "var(--mono)" }}>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>.
      </div>
    );
  }

  const statusColor =
    status.kind === "err"
      ? "#b3261e"
      : status.kind === "warn"
        ? "#a86700"
        : status.kind === "ok"
          ? `color-mix(in oklab, ${accent} 72%, #000)`
          : "#9a9a9a";

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          className="fld"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            onUrlChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              fetchDoc();
            }
          }}
          placeholder="Paste the Project Description doc URL to auto-fill…"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={fetchDoc}
          disabled={status.kind === "loading" || !url.trim()}
          style={{
            whiteSpace: "nowrap",
            padding: "0 16px",
            border: "none",
            borderRadius: 7,
            cursor:
              status.kind === "loading" || !url.trim() ? "not-allowed" : "pointer",
            background:
              status.kind === "loading" || !url.trim()
                ? "#cfcfcf"
                : `color-mix(in oklab, ${accent} 88%, #000)`,
            color: "#fff",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {status.kind === "loading" ? "Fetching…" : "Fetch blurb"}
        </button>
      </div>
      {status.kind !== "idle" && status.kind !== "loading" && (
        <div style={{ fontSize: 12.5, color: statusColor, marginTop: 7 }}>
          {status.kind === "ok" ? "✓ " : status.kind === "warn" ? "⚠ " : "✕ "}
          {status.msg}
        </div>
      )}
    </div>
  );
}
