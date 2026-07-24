"use client";
// Image uploader. Downscales the dropped/selected file to a WebP data URL in
// the browser, POSTs it to /api/upload (which stores it in the S3 bucket), and
// reports the returned object KEY up via onChange. The parent persists the key
// on the project; the bucket serves it through /api/img/<key>.
import { useCallback, useId, useRef, useState } from "react";
import { keyToUrl } from "@/lib/imageClient";

const MAX_DIM = 1200;
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/avif"];

async function toDataUrl(file: File, targetW: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const cap = Math.min(MAX_DIM, Math.max(1, Math.round(targetW * 2)) || MAX_DIM);
    const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    bitmap.close?.();
  }
}

export default function ImageSlot({
  value,
  onChange,
  placeholder = "Drop an image",
  radius = 8,
  aspectRatio = "4 / 3",
  style,
  endpoint = "/api/upload",
}: {
  value: string | null; // stored S3 key (or null)
  onChange: (key: string | null) => void;
  placeholder?: string;
  radius?: number;
  aspectRatio?: string;
  style?: React.CSSProperties;
  // Upload endpoint. Defaults to the admin route; the token-gated PM uploader
  // passes /api/contribute/<token>. Both accept { dataUrl } and return { key }.
  endpoint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // local data URL
  const inputId = useId();

  const ingest = useCallback(
    async (file: File | undefined) => {
      setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        setError("Drop a PNG, JPEG, WebP, or AVIF image.");
        return;
      }
      try {
        const w = hostRef.current?.clientWidth || MAX_DIM;
        const dataUrl = await toDataUrl(file, w);
        setPreview(dataUrl); // instant preview while uploading
        setUploading(true);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: "" }));
          throw new Error(error || `Upload failed (${res.status})`);
        }
        const { key } = await res.json();
        onChange(key);
      } catch (e) {
        setPreview(null);
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [onChange, endpoint]
  );

  const displaySrc = preview ?? (value ? keyToUrl(value) : null);

  return (
    <div
      ref={hostRef}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        ingest(e.dataTransfer.files?.[0]);
      }}
      style={{
        position: "relative",
        aspectRatio,
        borderRadius: radius,
        overflow: "hidden",
        background: displaySrc ? "#000" : "rgba(0,0,0,0.04)",
        outline: over ? "2px solid var(--accent)" : "none",
        outlineOffset: -2,
        cursor: displaySrc ? "default" : "pointer",
        ...style,
      }}
    >
      {displaySrc ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displaySrc}
            alt={placeholder}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              opacity: uploading ? 0.55 : 1,
            }}
          />
          {uploading && (
            <span
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "#fff",
                background: "rgba(0,0,0,0.6)",
                padding: "3px 8px",
                borderRadius: 5,
              }}
            >
              Uploading…
            </span>
          )}
          {!uploading && (
            <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
              <button type="button" onClick={() => inputRef.current?.click()} style={ctlBtn}>
                Replace
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  onChange(null);
                }}
                style={ctlBtn}
              >
                Remove
              </button>
            </div>
          )}
        </>
      ) : (
        <label
          htmlFor={inputId}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            textAlign: "center",
            padding: 12,
            cursor: "pointer",
            color: "rgba(0,0,0,0.55)",
            font: "13px/1.3 var(--body)",
          }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.45 }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span style={{ fontWeight: 500, maxWidth: "90%" }}>{placeholder}</span>
          <span style={{ fontSize: 11 }}>
            or <u style={{ textUnderlineOffset: 2 }}>browse files</u>
          </span>
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              border: `1.5px dashed ${over ? "var(--accent)" : "rgba(0,0,0,0.25)"}`,
              borderRadius: radius,
              pointerEvents: "none",
            }}
          />
        </label>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            bottom: 8,
            color: "#b3261e",
            fontSize: 11,
            background: "rgba(255,255,255,0.9)",
            padding: "4px 6px",
            borderRadius: 5,
            pointerEvents: "none",
          }}
        >
          {error}
        </div>
      )}

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(",")}
        hidden
        onChange={(e) => {
          ingest(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const ctlBtn: React.CSSProperties = {
  appearance: "none",
  border: 0,
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  background: "rgba(0,0,0,0.65)",
  color: "#fff",
  font: "11px/1 var(--body)",
  backdropFilter: "blur(6px)",
};
