"use client";
// Admin — CSV import page. Upload a CSV exported from the Spark! PM tracker
// Google Sheet, preview the parsed rows, then POST them to /api/admin/import-csv
// (a thin server-side proxy that adds the import secret before forwarding to
// /api/import). The CSV is parsed entirely in the browser — no third-party lib.
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/useToast";

const ACCENT = "#0fa392";
const MAX_BYTES = 5 * 1024 * 1024; // ~5MB cap

// ---------------------------------------------------------------------------
// RFC 4180 CSV parser (no npm packages)
// Returns string[][] — outer array = rows, inner array = fields.
// Handles: quoted fields, commas inside quotes, newlines inside quotes,
// "" as escaped quote, CRLF and LF endings, trailing newline.
// ---------------------------------------------------------------------------
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Peek: two double-quotes = escaped literal quote
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r" || ch === "\n") {
        // Handle CRLF as single line ending
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push the last field and row (no trailing newline case)
  row.push(field);
  // Don't push an empty trailing row
  if (row.some((f) => f.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Column header → IncomingRow field mapping (case-insensitive, strip spaces)
// ---------------------------------------------------------------------------
type FieldKey =
  | "project"
  | "client"
  | "clientType"
  | "discipline"
  | "blurb"
  | "repoUrl"
  | "prodUrl"
  | "pdUrl"
  | "driveUrl"
  | "programLead"
  | "pm"
  | "tpm"
  | "seniorAdvisor"
  | "techAdvisor"
  | "eir"
  | "course"
  | "semester";

const HEADER_MAP: Record<string, FieldKey> = {
  "project title": "project",
  title: "project",
  semester: "semester",
  term: "semester",
  course: "course",
  "course code": "course",
  client: "client",
  partner: "client",
  "client / partner": "client",
  "client type": "clientType",
  clienttype: "clientType",
  discipline: "discipline",
  track: "discipline",
  blurb: "blurb",
  description: "blurb",
  "project description": "blurb",
  "repo url": "repoUrl",
  github: "repoUrl",
  "github url": "repoUrl",
  "prod url": "prodUrl",
  "live url": "prodUrl",
  "demo url": "prodUrl",
  "pd url": "pdUrl",
  "portfolio doc": "pdUrl",
  "drive url": "driveUrl",
  drive: "driveUrl",
  "google drive": "driveUrl",
  "program lead": "programLead",
  "spark! program lead": "programLead",
  "spark program lead": "programLead",
  pm: "pm",
  "project manager": "pm",
  tpm: "tpm",
  "technical project manager": "tpm",
  "senior advisor": "seniorAdvisor",
  "senior spark! advisor": "seniorAdvisor",
  "tech advisor": "techAdvisor",
  "spark! tech advisor": "techAdvisor",
  eir: "eir",
  "entrepreneur in residence": "eir",
};

// Stable, logical column order for the preview table. Keys not listed here
// fall to the end (preserving discovery order).
const COLUMN_ORDER: FieldKey[] = [
  "project",
  "semester",
  "course",
  "client",
  "clientType",
  "discipline",
  "blurb",
  "repoUrl",
  "prodUrl",
  "pdUrl",
  "driveUrl",
  "programLead",
  "pm",
  "tpm",
  "seniorAdvisor",
  "techAdvisor",
  "eir",
];

type IncomingRow = Partial<Record<FieldKey, string>>;

function mapHeaders(headers: string[]): (FieldKey | null)[] {
  return headers.map((h) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, " ");
    return HEADER_MAP[key] ?? null;
  });
}

function parseRows(raw: string[][]): IncomingRow[] {
  if (raw.length < 2) return [];
  const [headerRow, ...dataRows] = raw;
  const fieldKeys = mapHeaders(headerRow);

  return dataRows
    .map((row) => {
      const obj: IncomingRow = {};
      row.forEach((cell, i) => {
        const key = fieldKeys[i];
        if (key && cell.trim() !== "") {
          obj[key] = cell.trim();
        }
      });
      return obj;
    })
    .filter((r) => Object.keys(r).length > 0);
}

// ---------------------------------------------------------------------------
// Types for API response
// ---------------------------------------------------------------------------
interface ImportResult {
  ok: boolean;
  received?: number;
  updated?: number;
  skippedCount?: number;
  skipped?: string[];
  inboxed?: number;
  noBlurb?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Shared style tokens for the column header / cell chrome
// ---------------------------------------------------------------------------
const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--faint)",
  borderBottom: "1px solid var(--rowsep)",
  whiteSpace: "nowrap",
  background: "var(--card-bg, #fff)",
};

const errBoxStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "12px 16px",
  background: "#fdf2f2",
  border: "1px solid #f5c6c6",
  borderRadius: 8,
  color: "#c0392b",
  fontFamily: "var(--mono)",
  fontSize: 13,
};

const nameListLabelStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  color: "var(--faint)",
  marginBottom: 6,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ImportCSVPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toastEl, notify } = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<IncomingRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [columnCount, setColumnCount] = useState(0);
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [skippedExpanded, setSkippedExpanded] = useState(false);

  const resetState = useCallback(() => {
    setFileName(null);
    setParsedRows([]);
    setParseError(null);
    setColumnCount(0);
    setUnknownHeaders([]);
    setResult(null);
    setNetworkError(null);
    setShowAll(false);
    setSkippedExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFile = useCallback((file: File) => {
    setResult(null);
    setNetworkError(null);
    setParseError(null);
    setUnknownHeaders([]);
    setShowAll(false);

    // Reject non-.csv before reading.
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please upload a .csv file.");
      setParsedRows([]);
      return;
    }
    // Size cap before reading — avoid pulling a huge file into memory.
    if (file.size > MAX_BYTES) {
      setParseError(
        `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 5MB.`
      );
      setParsedRows([]);
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") {
        setParseError("Could not read file.");
        return;
      }
      try {
        const raw = parseCSV(text);
        if (raw.length < 2) {
          setParseError("CSV has no data rows (need at least a header + 1 row).");
          setParsedRows([]);
          return;
        }
        const headerRow = raw[0] ?? [];
        setColumnCount(headerRow.length);
        // Compute unrecognized headers client-side: any non-empty header that
        // maps to null in HEADER_MAP. Catches a mislabeled column before import.
        const mapped = mapHeaders(headerRow);
        const unknown = headerRow
          .map((h, i) => ({ h: h.trim(), key: mapped[i] }))
          .filter((c) => c.h !== "" && c.key === null)
          .map((c) => c.h);
        setUnknownHeaders(unknown);
        const rows = parseRows(raw);
        setParsedRows(rows);
      } catch (err) {
        setParseError(`CSV parse error: ${err instanceof Error ? err.message : String(err)}`);
        setParsedRows([]);
      }
    };
    reader.onerror = () => setParseError("Failed to read file.");
    reader.readAsText(file);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!parsedRows.length || importing) return;
    setImporting(true);
    setResult(null);
    setNetworkError(null);

    try {
      const res = await fetch("/api/admin/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      let data: ImportResult | null = null;
      try {
        data = (await res.json()) as ImportResult;
      } catch {
        data = null;
      }
      // Guard on res.ok: a 4xx/5xx (even with a JSON body) is an error, never
      // "Import complete".
      if (!res.ok) {
        const msg =
          data?.error || `Import failed (HTTP ${res.status} ${res.statusText}).`;
        setNetworkError(msg);
        notify("err", "Import failed");
        return;
      }
      setResult(data);
      if (data?.error) {
        notify("err", "Import failed");
      } else {
        notify("ok", `Imported · ${data?.updated ?? 0} updated`);
      }
    } catch (err) {
      const msg = `Network error: ${
        err instanceof Error ? err.message : "Could not reach the server."
      }`;
      setNetworkError(msg);
      notify("err", "Network error");
    } finally {
      setImporting(false);
    }
  };

  // Preview: all keys present across the rows, ordered by COLUMN_ORDER.
  const previewKeys = useMemo(() => {
    const present = new Set<FieldKey>(
      parsedRows.flatMap((r) => Object.keys(r) as FieldKey[])
    );
    const ordered = COLUMN_ORDER.filter((k) => present.has(k));
    // Any present key not in COLUMN_ORDER goes to the end (defensive).
    const rest = [...present].filter((k) => !COLUMN_ORDER.includes(k));
    return [...ordered, ...rest];
  }, [parsedRows]);

  const PREVIEW_CAP = 5;
  const previewRows = showAll ? parsedRows : parsedRows.slice(0, PREVIEW_CAP);
  const hiddenCount = parsedRows.length - previewRows.length;

  const importBtn = (
    <button
      className="btn btn-dark"
      onClick={handleImport}
      disabled={importing}
      style={{
        cursor: importing ? "not-allowed" : "pointer",
        opacity: importing ? 0.7 : 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {importing ? (
        <>
          <span
            style={{
              display: "inline-block",
              width: 13,
              height: 13,
              border: "2px solid rgba(255,255,255,0.3)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}
          />
          Importing…
        </>
      ) : (
        `Import ${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"}`
      )}
    </button>
  );

  return (
    <>
      <div className="wrap">
        <div className="page-eyebrow">Ingestion</div>
        <h1 className="page">Import CSV</h1>
        <p className="subcopy">
          Upload a CSV exported from the Spark! PM tracker Google Sheet. Columns are matched
          case-insensitively — unrecognized columns are ignored. Rows that don&apos;t match
          an existing project are queued in the{" "}
          <Link href="/admin/inbox" style={{ color: ACCENT }}>
            import inbox
          </Link>{" "}
          for triage.
        </p>

        {/* ── File drop zone ── */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginTop: 28,
            border: `2px dashed ${isDragging ? ACCENT : "var(--line, #d8dbd9)"}`,
            borderRadius: 12,
            padding: "36px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: isDragging
              ? `color-mix(in oklab, ${ACCENT} 6%, #fff)`
              : "var(--card-bg, #fff)",
            transition: "border-color .15s, background .15s",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={onFileChange}
            style={{ display: "none" }}
          />
          <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 12, color: isDragging ? ACCENT : "#c4c7c5" }}>
            ⬆
          </div>
          {fileName ? (
            <div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 13,
                  color: "var(--ink)",
                  fontWeight: 600,
                }}
              >
                {fileName}
              </div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4 }}>
                Click or drag to replace
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontFamily: "var(--display)",
                  fontWeight: 600,
                  fontSize: 15,
                  color: "var(--ink)",
                }}
              >
                Drop a .csv file here, or click to browse
              </div>
              <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 6 }}>
                Accepts .csv files from the Spark! PM tracker sheet (max 5MB)
              </div>
            </div>
          )}
        </div>

        {/* ── Clear / import another ── */}
        {(fileName || parsedRows.length > 0 || parseError || result) && (
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={resetState}>
              Clear &amp; import another file
            </button>
          </div>
        )}

        {/* ── Parse error ── */}
        {parseError && <div style={errBoxStyle}>{parseError}</div>}

        {/* ── Unrecognized column headers ── */}
        {unknownHeaders.length > 0 && !parseError && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              background: "var(--amber-bg, #fdf6e3)",
              border: "1px solid var(--amber-line, #ecd9a0)",
              borderRadius: 8,
              color: "var(--amber-ink, #8a6d1f)",
              fontFamily: "var(--mono)",
              fontSize: 12.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {unknownHeaders.length} column
              {unknownHeaders.length === 1 ? "" : "s"} not recognized — data in
              {unknownHeaders.length === 1 ? " it" : " them"} will be ignored:
            </div>
            <div style={{ lineHeight: 1.6 }}>
              {unknownHeaders.map((h) => (
                <span key={h} className="chip" style={{ marginRight: 6 }}>
                  {h}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              Re-check the header row if a column above should have been mapped.
            </div>
          </div>
        )}

        {/* ── Parse success summary ── */}
        {parsedRows.length > 0 && !parseError && (
          <div style={{ marginTop: 22 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: "var(--display)",
                    fontWeight: 700,
                    fontSize: 15,
                    color: "var(--ink)",
                  }}
                >
                  Preview
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--faint)",
                    marginLeft: 12,
                  }}
                >
                  {parsedRows.length} row{parsedRows.length === 1 ? "" : "s"} ·{" "}
                  {columnCount} column{columnCount === 1 ? "" : "s"} detected ·{" "}
                  showing {showAll ? "all" : `first ${Math.min(PREVIEW_CAP, parsedRows.length)}`}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {parsedRows.length > PREVIEW_CAP && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowAll((s) => !s)}
                  >
                    {showAll ? "Show first 5" : `Show all ${parsedRows.length}`}
                  </button>
                )}
                {importBtn}
              </div>
            </div>

            {/* Preview table */}
            <div className="card" style={{ overflow: "auto", padding: 0 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>#</th>
                    {previewKeys.map((k) => (
                      <th key={k} style={thStyle}>
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      <td
                        style={{
                          padding: "9px 14px",
                          borderBottom: "1px solid var(--rowsep)",
                          color: "var(--faint)",
                          verticalAlign: "top",
                        }}
                      >
                        {i + 1}
                      </td>
                      {previewKeys.map((k) => (
                        <td
                          key={k}
                          style={{
                            padding: "9px 14px",
                            borderBottom: "1px solid var(--rowsep)",
                            color: "var(--ink)",
                            verticalAlign: "top",
                            maxWidth: 220,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={row[k] ?? ""}
                        >
                          {row[k] ?? (
                            <span style={{ color: "var(--faint)", fontStyle: "italic" }}>—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {hiddenCount > 0 && (
                <div
                  style={{
                    padding: "10px 14px",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--faint)",
                    borderTop: "1px solid var(--rowsep)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  … and {hiddenCount} more row{hiddenCount === 1 ? "" : "s"} not shown
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowAll(true)}
                  >
                    Show all
                  </button>
                </div>
              )}
            </div>

            {/* Duplicate import CTA below the table for long files */}
            <div
              style={{
                marginTop: 14,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              {importBtn}
            </div>
          </div>
        )}

        {/* ── Network / HTTP error ── */}
        {networkError && (
          <div style={{ ...errBoxStyle, marginTop: 20 }}>{networkError}</div>
        )}

        {/* ── Import result summary ── */}
        {result && !networkError && (
          <div
            style={{
              marginTop: 20,
              padding: "18px 20px",
              background: result.ok
                ? `color-mix(in oklab, ${ACCENT} 8%, #fff)`
                : "#fdf2f2",
              border: `1px solid ${result.ok ? `color-mix(in oklab, ${ACCENT} 30%, #fff)` : "#f5c6c6"}`,
              borderRadius: 10,
            }}
          >
            {result.error ? (
              <div style={{ color: "#c0392b", fontFamily: "var(--mono)", fontSize: 13 }}>
                API error: {result.error}
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontFamily: "var(--display)",
                    fontWeight: 700,
                    fontSize: 16,
                    color: ACCENT,
                    marginBottom: 10,
                  }}
                >
                  Import complete
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: 12,
                  }}
                >
                  {[
                    { label: "Received", value: result.received ?? 0 },
                    { label: "Updated", value: result.updated ?? 0 },
                    { label: "Inboxed", value: result.inboxed ?? 0 },
                    { label: "Skipped", value: result.skippedCount ?? 0 },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      style={{
                        background: "var(--card-bg, #fff)",
                        borderRadius: 8,
                        padding: "12px 14px",
                        border: "1px solid var(--line, #e2e5e3)",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--display)",
                          fontWeight: 700,
                          fontSize: 26,
                          lineHeight: 1,
                          color: "var(--ink)",
                        }}
                      >
                        {value}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "var(--faint)",
                          marginTop: 6,
                        }}
                      >
                        {label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Unmatched project names — queued in inbox, expandable */}
                {result.skipped && result.skipped.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={nameListLabelStyle}>
                      Unmatched project names (queued in inbox)
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 12,
                        color: "var(--sec)",
                        lineHeight: 1.6,
                      }}
                    >
                      {(skippedExpanded
                        ? result.skipped
                        : result.skipped.slice(0, 10)
                      ).join(", ")}
                      {!skippedExpanded && result.skipped.length > 10 && (
                        <>
                          {" "}
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSkippedExpanded(true)}
                          >
                            Show all {result.skipped.length}
                          </button>
                        </>
                      )}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Link
                        href="/admin/inbox"
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 12.5,
                          color: ACCENT,
                          textDecoration: "none",
                        }}
                      >
                        Open the import inbox →
                      </Link>
                    </div>
                  </div>
                )}

                {/* Matched but PD had no extractable blurb */}
                {result.noBlurb && result.noBlurb.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={nameListLabelStyle}>
                      Missing blurb (matched, but the PD doc had no description block)
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 12,
                        color: "var(--sec)",
                        lineHeight: 1.6,
                      }}
                    >
                      {result.noBlurb.join(", ")}
                    </div>
                  </div>
                )}

                {(result.inboxed ?? 0) > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <Link
                      href="/admin/inbox"
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 12.5,
                        color: ACCENT,
                        textDecoration: "none",
                      }}
                    >
                      Review {result.inboxed} new inbox row
                      {result.inboxed === 1 ? "" : "s"} →
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {toastEl}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
