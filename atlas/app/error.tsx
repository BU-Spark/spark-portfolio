"use client";
// Route-level error boundary for the public app. A transient DB/S3 hiccup (e.g.
// a cold Railway proxy) used to crash the whole page with Next's bare error
// screen; this renders a branded, retryable fallback instead.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "0 24px",
        textAlign: "center",
        background: "#f4f5f4",
      }}
    >
      <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 22, color: "#16191c" }}>
        Something went wrong
      </div>
      <p style={{ fontSize: 15, color: "#6a6f74", maxWidth: 440, lineHeight: 1.55, margin: 0 }}>
        We hit a temporary problem loading this page. It&rsquo;s usually a brief
        blip — try again in a moment.
      </p>
      <button
        onClick={reset}
        style={{
          padding: "11px 22px",
          border: "none",
          borderRadius: 7,
          cursor: "pointer",
          background: "#0fa392",
          color: "#fff",
          fontFamily: "var(--display)",
          fontSize: 14.5,
          fontWeight: 600,
        }}
      >
        Try again
      </button>
    </div>
  );
}
