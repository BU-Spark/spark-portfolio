"use client";
// The uploader shown on a live magic link. Reuses <ImageSlot> (pointed at the
// token endpoint) for adding images, and keeps the server's pending-image array
// as the source of truth — every add/remove refetches state, so what you see
// matches what's stored. Up to 4 screenshots, then a "Submit for review" button.
import { useCallback, useEffect, useState } from "react";
import ImageSlot from "@/components/ImageSlot";
import { keyToUrl } from "@/lib/imageClient";

const ACCENT = "#0fa392";
const CAP = 4;

export default function UploadClient({
  token,
  projectTitle,
  projectBlurb,
  initialImages,
  reviewNote,
  initialSubmitted = false,
  replyTo,
}: {
  token: string;
  projectTitle: string;
  projectBlurb: string;
  initialImages: string[];
  reviewNote: string | null;
  initialSubmitted?: boolean;
  replyTo: string; // passed in: lib/email imports Resend, keep it out of the client bundle
}) {
  const endpoint = `/api/contribute/${token}`;
  const [images, setImages] = useState<string[]>(initialImages);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [reopening, setReopening] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync from the server (the authoritative pending set).
  const refetch = useCallback(async () => {
    const res = await fetch(endpoint);
    if (res.status === 410 || res.status === 404) {
      setGone(true);
      return;
    }
    const data = await res.json().catch(() => null);
    if (data?.images) setImages(data.images as string[]);
  }, [endpoint]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4500);
    return () => clearTimeout(t);
  }, [error]);

  const removeImage = useCallback(
    async (key: string) => {
      setBusy(true);
      try {
        const res = await fetch(endpoint, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        if (!res.ok && res.status !== 410) throw new Error("Could not remove that image.");
        await refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not remove that image.");
      } finally {
        setBusy(false);
      }
    },
    [endpoint, refetch]
  );

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}/submit`, { method: "POST" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || "Could not submit.");
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }, [endpoint]);

  const reopen = useCallback(async () => {
    setReopening(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}/reopen`, { method: "POST" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || "Could not reopen.");
      }
      await refetch();
      setSubmitted(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen.");
    } finally {
      setReopening(false);
    }
  }, [endpoint, refetch]);

  if (submitted) {
    return (
      <>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 24, color: "#16191c", margin: "0 0 10px" }}>
          Submitted — thank you!
        </h1>
        <p style={{ fontSize: 15, color: "#6a6f74", lineHeight: 1.55, margin: 0 }}>
          Your screenshots for <strong>{projectTitle}</strong> are with the BU Spark! team for
          review. They&rsquo;ll appear on the project page once approved. You can close this tab.
        </p>
        <p style={{ fontSize: 14, color: "#6a6f74", margin: "18px 0 0" }}>
          Forgot one? Reopening pulls the submission back so you (or a teammate with this link) can
          add more, then submit again.
        </p>
        <button
          type="button"
          onClick={reopen}
          disabled={reopening}
          style={{
            marginTop: 10,
            padding: "10px 18px",
            border: `1.5px solid ${ACCENT}`,
            borderRadius: 7,
            background: "#fff",
            color: ACCENT,
            cursor: reopening ? "wait" : "pointer",
            fontFamily: "var(--display)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {reopening ? "Reopening…" : "Upload more screenshots"}
        </button>
        {error && <div style={{ color: "#b3261e", fontSize: 13.5, marginTop: 12 }}>{error}</div>}
      </>
    );
  }

  if (gone) {
    return (
      <>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 24, color: "#16191c", margin: "0 0 10px" }}>
          This link is no longer active
        </h1>
        <p style={{ fontSize: 15, color: "#6a6f74", lineHeight: 1.55, margin: 0 }}>
          It may have expired or already been submitted. Ask your BU Spark! contact for a new link.
        </p>
        <p style={{ fontSize: 14, color: "#6a6f74", lineHeight: 1.55, margin: "14px 0 0" }}>
          Questions? Email <a href={`mailto:${replyTo}`} style={{ color: ACCENT }}>{replyTo}</a>.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 24, color: "#16191c", margin: "0 0 6px" }}>
        Add screenshots
      </h1>
      <p style={{ fontSize: 15, color: "#16191c", margin: "0 0 4px", fontWeight: 600 }}>
        {projectTitle}
      </p>
      {projectBlurb && (
        <p style={{ fontSize: 14, color: "#6a6f74", lineHeight: 1.5, margin: "0 0 18px" }}>
          {projectBlurb}
        </p>
      )}
      <p style={{ fontSize: 13.5, color: "#6a6f74", lineHeight: 1.5, margin: "0 0 12px" }}>
        Upload up to {CAP} screenshots of this project. When you&rsquo;re done, hit{" "}
        <strong>Submit for review</strong> — a BU Spark! admin will publish them. No account needed,
        and you can share this link with a teammate.
      </p>

      {/* Stated up front because the downscale is irreversible: a 700px-wide
          screenshot cannot be sharpened later, and the first sign of it is a
          soft image on the public project page. */}
      <ul
        style={{
          fontSize: 13,
          color: "#6a6f74",
          lineHeight: 1.6,
          margin: "0 0 18px",
          paddingLeft: 18,
        }}
      >
        <li>
          <strong>PNG, JPEG, or WebP</strong> — up to 6MB each.
        </li>
        <li>
          <strong>At least 1600px wide</strong> is ideal. Larger is fine (we resize to 2000px);
          smaller will look soft once published.
        </li>
        <li>
          Full-window screenshots work best — they&rsquo;re shown wide at the top of the project
          page and can be opened full size.
        </li>
      </ul>

      {reviewNote && (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 9,
            padding: "12px 14px",
            marginBottom: 18,
            fontSize: 13.5,
            color: "#9a3412",
          }}
        >
          <strong>Note from the reviewer:</strong> {reviewNote}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
          marginBottom: 22,
        }}
      >
        {images.map((key) => (
          <div
            key={key}
            style={{
              position: "relative",
              aspectRatio: "4 / 3",
              borderRadius: 8,
              overflow: "hidden",
              background: "#000",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={keyToUrl(key)}
              alt="screenshot"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            <button
              type="button"
              onClick={() => removeImage(key)}
              disabled={busy}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                appearance: "none",
                border: 0,
                borderRadius: 6,
                padding: "5px 10px",
                cursor: busy ? "not-allowed" : "pointer",
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                font: "11px/1 var(--body)",
              }}
            >
              Remove
            </button>
          </div>
        ))}

        {images.length < CAP && (
          // No remount key here: a multi-file drop uploads in sequence inside
          // this one slot, and remounting it after the first refetch would
          // orphan the rest of the queue.
          <ImageSlot
            value={null}
            endpoint={endpoint}
            max={CAP - images.length}
            onChange={(key) => {
              if (key) refetch();
            }}
            placeholder={images.length ? "Add more" : "Add screenshots"}
            aspectRatio="4 / 3"
          />
        )}
      </div>

      {error && (
        <div style={{ color: "#b3261e", fontSize: 13.5, marginBottom: 14 }}>{error}</div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || images.length < 1}
        style={{
          padding: "13px 26px",
          border: "none",
          borderRadius: 7,
          cursor: submitting || images.length < 1 ? "not-allowed" : "pointer",
          background: submitting || images.length < 1 ? "#cfcfcf" : ACCENT,
          color: "#fff",
          fontFamily: "var(--display)",
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        {submitting ? "Submitting…" : "Submit for review"}
      </button>
      {images.length < 1 && (
        <span style={{ fontSize: 12.5, color: "#9a9a9a", marginLeft: 12 }}>
          Add at least one screenshot first.
        </span>
      )}
    </>
  );
}
