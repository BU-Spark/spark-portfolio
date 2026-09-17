"use client";
// Project image gallery: a hero plus thumbnails, any of which opens full size.
//
// Split out of ProjectView (a server component) because the lightbox needs
// state. Two behaviours differ from the markup it replaces:
//
//   1. Only images that EXIST get a tile. The old grid always rendered three
//      thumbnail slots, so a project with two screenshots showed two striped
//      placeholders, which reads as "broken images" rather than "no more
//      images". A project with none still gets the single striped hero, which
//      is the intended empty state.
//   2. Tiles are buttons. They were plain <img>, so there was no way to see a
//      screenshot at full size — the thing a screenshot exists for.
import { useCallback, useEffect, useState } from "react";

export default function ProjectGallery({
  title,
  images,
  color,
  seed,
}: {
  title: string;
  images: (string | null)[] | undefined;
  color: string;
  seed: number;
}) {
  const urls = (images ?? []).filter((u): u is string => !!u);
  const [open, setOpen] = useState<number | null>(null);

  const close = useCallback(() => setOpen(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpen((i) => (i === null ? null : (i + delta + urls.length) % urls.length)),
    [urls.length]
  );

  // Escape closes, arrows move. Bound on document rather than the overlay so it
  // works no matter what the click landed on.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    // The page behind a modal must not scroll; restored on unmount so an early
    // navigation can't leave the body locked.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, step]);

  const striped = (index: number, primary: boolean) => {
    const angle = 90 + ((index * 37 + seed) % 4) * 30;
    return {
      width: "100%",
      aspectRatio: primary ? "16 / 9" : "4 / 3",
      borderRadius: primary ? 10 : 7,
      overflow: "hidden" as const,
      background: `repeating-linear-gradient(${angle}deg, color-mix(in oklab, ${color} ${18 - index * 2}%, #fff) 0 14px, color-mix(in oklab, ${color} 7%, #fff) 14px 28px)`,
    };
  };

  if (!urls.length) return <div style={striped(0, true)} />;

  const tile = (url: string, index: number, primary: boolean) => (
    <button
      key={url}
      type="button"
      onClick={() => setOpen(index)}
      title="Click to view full size"
      style={{
        display: "block",
        padding: 0,
        border: "none",
        background: "none",
        cursor: "zoom-in",
        width: "100%",
        aspectRatio: primary ? "16 / 9" : "4 / 3",
        borderRadius: primary ? 10 : 7,
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${title} screenshot ${index + 1}`}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </button>
  );

  return (
    <>
      {tile(urls[0], 0, true)}
      {urls.length > 1 && (
        <div
          style={{
            display: "grid",
            // Match the widths the old fixed 3-column grid produced, so two
            // thumbnails don't stretch to half the page each.
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
            marginTop: 6,
          }}
        >
          {urls.slice(1).map((u, i) => tile(u, i + 1, false))}
        </div>
      )}

      {open !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} screenshot ${open + 1} of ${urls.length}`}
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(16,19,22,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urls[open]}
            alt={`${title} screenshot ${open + 1}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 6,
              cursor: "default",
              boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
            }}
          />
          {urls.length > 1 && (
            <div
              style={{
                position: "fixed",
                bottom: 18,
                left: "50%",
                transform: "translateX(-50%)",
                color: "#fff",
                font: "12.5px/1 var(--mono, ui-monospace), monospace",
                letterSpacing: "0.08em",
                opacity: 0.75,
              }}
            >
              {open + 1} / {urls.length} — ← → to move, Esc to close
            </div>
          )}
        </div>
      )}
    </>
  );
}
