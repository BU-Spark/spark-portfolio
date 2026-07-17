"use client";
// Last-resort boundary if the root layout itself throws. Must render <html>/<body>.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "0 24px",
          textAlign: "center",
          background: "#f4f5f4",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 22, color: "#16191c" }}>
          Something went wrong
        </div>
        <p style={{ fontSize: 15, color: "#6a6f74", maxWidth: 440, lineHeight: 1.55, margin: 0 }}>
          We hit a temporary problem. Please try again in a moment.
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
            fontSize: 14.5,
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
