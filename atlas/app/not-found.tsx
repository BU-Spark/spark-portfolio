// Branded 404 for unknown routes and notFound() (e.g. a missing project slug).
import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "0 24px",
        textAlign: "center",
        background: "#f4f5f4",
      }}
    >
      <div style={{ fontFamily: "var(--mono)", fontSize: 13, letterSpacing: "0.12em", color: "#0fa392", textTransform: "uppercase" }}>
        404
      </div>
      <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 22, color: "#16191c" }}>
        Page not found
      </div>
      <p style={{ fontSize: 15, color: "#6a6f74", maxWidth: 420, lineHeight: 1.55, margin: 0 }}>
        That project or page doesn&rsquo;t exist. It may have been moved or unpublished.
      </p>
      <Link
        href="/"
        style={{
          padding: "11px 22px",
          borderRadius: 7,
          background: "#16191c",
          color: "#fff",
          textDecoration: "none",
          fontFamily: "var(--display)",
          fontSize: 14.5,
          fontWeight: 600,
        }}
      >
        Back to the gallery →
      </Link>
    </div>
  );
}
