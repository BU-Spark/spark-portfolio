"use client";
// Admin login. Google OAuth only — restricted to allowlisted @bu.edu accounts
// (see auth.ts). On success Auth.js returns to /admin; a rejected account (not
// on the allowlist, or not a bu.edu address) comes back here with ?error.
//
// Full-bleed "Spark Control" gate: AdminShell special-cases /admin/login to
// render this without the rail, inside `.spark-control` (so var(--teal) etc.
// resolve). Dark teal-glow backdrop, centered white card.
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);

  // Auth.js redirects a rejected signIn() to /admin/login?error=AccessDenied.
  // Read it from the URL directly (no useSearchParams → no Suspense boundary).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setDenied(true);
  }, []);

  function handleSignIn() {
    setPending(true);
    signIn("google", { callbackUrl: "/admin" });
  }

  return (
    <>
      {/* Spin keyframe + teal radial-glow backdrop. Scoped to the login layout
          via the data attribute so it can't leak into the rest of the shell.
          Reduced-motion safe (spark-control.css already kills animations). */}
      <style>{`
        @keyframes spark-login-spin { to { transform: rotate(360deg); } }
        [data-spark-login]{ position:relative; overflow:hidden; }
        [data-spark-login]::before{ content:""; position:absolute; top:-20%; left:-10%;
          width:60%; height:80%; pointer-events:none;
          background:radial-gradient(circle, rgba(15,182,160,.22), transparent 65%); }
        [data-spark-login]::after{ content:""; position:absolute; bottom:-20%; right:-10%;
          width:55%; height:70%; pointer-events:none;
          background:radial-gradient(circle, rgba(15,182,160,.10), transparent 65%); }
      `}</style>
      <div
        data-spark-login
        style={{
          minHeight: "100vh",
          background: "var(--rail)",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily: "var(--body)",
        }}
      >
        <div style={{ width: "min(420px, 92vw)", position: "relative", zIndex: 1 }}>
          {/* Logo mark — teal gradient, glowing */}
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 16,
              background: "linear-gradient(150deg, var(--teal), var(--teal-deep))",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 20px",
              boxShadow: "var(--sh-teal)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--display)",
                fontWeight: 700,
                fontSize: 28,
                color: "#04201c",
              }}
            >
              S
            </span>
          </div>

          {/* Card */}
          <div
            style={{
              background: "var(--panel)",
              borderRadius: 20,
              padding: "38px 36px",
              textAlign: "center",
              boxShadow: "0 30px 70px -20px rgba(0,0,0,.5)",
            }}
          >
            {/* Brand line: Spark! / Control */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "center",
                gap: 8,
                marginBottom: 18,
              }}
            >
              <b
                style={{
                  fontFamily: "var(--display)",
                  fontWeight: 700,
                  fontSize: 18,
                  color: "var(--ink)",
                  whiteSpace: "nowrap",
                }}
              >
                Spark<i style={{ color: "var(--teal)", fontStyle: "normal" }}>!</i>
              </b>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--ink-4)",
                  letterSpacing: "0.08em",
                }}
              >
                / Control
              </span>
            </div>

            {/* Access-denied banner (driven by ?error) */}
            {denied && (
              <div
                style={{
                  display: "flex",
                  gap: 11,
                  textAlign: "left",
                  background: "var(--rose-bg)",
                  border: "1px solid var(--rose-line)",
                  borderRadius: 11,
                  padding: "13px 15px",
                  marginBottom: 22,
                }}
              >
                {/* Info icon */}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#c0362b"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0, marginTop: 1 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <div
                  style={{
                    fontSize: 13,
                    color: "#7a2620",
                    lineHeight: 1.5,
                  }}
                >
                  That account isn&rsquo;t on the admin allowlist. Ask an existing
                  Spark! admin to add your <strong>@bu.edu</strong> email &mdash;{" "}
                  <a
                    href="mailto:spark@bu.edu?subject=Admin%20access%20request"
                    style={{ color: "var(--rose)", fontWeight: 600 }}
                  >
                    email spark@bu.edu
                  </a>
                  .
                </div>
              </div>
            )}

            {/* Heading */}
            <h1
              style={{
                fontFamily: "var(--display)",
                fontSize: 25,
                letterSpacing: "-0.01em",
                margin: "0 0 10px",
                fontWeight: 700,
                color: "var(--ink)",
              }}
            >
              Sign in
            </h1>

            {/* Sub-copy: @bu.edu only */}
            <p
              style={{
                fontSize: 13.5,
                lineHeight: 1.55,
                color: "var(--ink-2)",
                margin: "0 0 26px",
              }}
            >
              Access is limited to approved{" "}
              <b style={{ color: "var(--ink)" }}>@bu.edu</b> Spark! admins.
              You&rsquo;ll land on the command center after signing in.
            </p>

            {/* Sign-in button */}
            <button
              onClick={handleSignIn}
              disabled={pending}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 11,
                border: "1px solid var(--field)",
                background: pending ? "var(--bg2)" : "var(--panel)",
                borderRadius: 11,
                padding: 13,
                cursor: pending ? "default" : "pointer",
                fontFamily: "var(--body)",
                fontSize: 15,
                fontWeight: 600,
                color: pending ? "var(--ink-4)" : "var(--ink)",
                transition: "border-color .15s, box-shadow .15s, background .15s",
              }}
              onMouseEnter={(e) => {
                if (!pending) {
                  const b = e.currentTarget;
                  b.style.borderColor = "var(--teal)";
                  b.style.boxShadow = "0 0 0 3px rgba(15,182,160,.1)";
                }
              }}
              onMouseLeave={(e) => {
                if (!pending) {
                  const b = e.currentTarget;
                  b.style.borderColor = "var(--field)";
                  b.style.boxShadow = "none";
                }
              }}
            >
              {pending ? <Spinner /> : <GoogleMark />}
              <span style={{ whiteSpace: "nowrap" }}>
                {pending ? "Redirecting to Google…" : "Sign in with Google"}
              </span>
            </button>
          </div>

          {/* Footer */}
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,.5)",
              marginTop: 22,
              textAlign: "center",
            }}
          >
            BU Spark! &middot; Faculty of Computing &amp; Data Sciences
          </div>
        </div>
      </div>
    </>
  );
}

// Google "G" mark (official 4-color), inline so there's no asset dependency.
function GoogleMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 3.18 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

// Spinner shown while pending redirect to Google OAuth.
function Spinner() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        border: "2px solid #cfd6d1",
        borderTopColor: "var(--teal)",
        borderRadius: "50%",
        display: "inline-block",
        animation: "spark-login-spin .7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}
