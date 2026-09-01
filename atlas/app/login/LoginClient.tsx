"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

const ACCENT = "#0fa392";

import { safeCallback } from "@/lib/callback";

export default function LoginClient() {
  const params = useSearchParams();
  // Resolved inside the click handler, NOT during render: a "use client" component
  // is still server-rendered first, and touching window there throws
  // ReferenceError: window is not defined. React recovers on the client so the page
  // still returns 200, which is exactly why this survived a smoke test.
  //
  // No explicit destination -> /after-login, a server route that resolves the actor
  // and sends admins to /admin and everyone else to the gallery. When Auth.js DID
  // supply a callbackUrl (bounced off a protected page), that wins: returning
  // someone to the page they asked for beats a role-appropriate guess.
  const rawCallback = params.get("callbackUrl");
  // Auth.js appends ?error=<code> on any failed sign-in. Rendering the specific
  // reason matters more than it looks: the default Auth.js error page says only
  // "Try again", which is indistinguishable between "your address is the wrong
  // domain" and "the server's OAuth secret is missing" — one is the person's
  // problem and one is ours.
  const error = params.get("error");
  const errorInfo: Record<string, { title: string; body: React.ReactNode }> = {
    AccessDenied: {
      title: "That address isn't a @bu.edu account",
      body: (
        <>
          Sign in with your <strong>@bu.edu</strong> Google account. A personal Gmail
          won&rsquo;t work — and neither will a BU <em>subdomain</em> address like{" "}
          <strong>@alum.bu.edu</strong> or <strong>@med.bu.edu</strong>, which look like
          BU addresses but aren&rsquo;t accepted yet. If that&rsquo;s the only address
          you have, tell the Spark! team.
        </>
      ),
    },
    Configuration: {
      title: "Sign-in is misconfigured on our side",
      body: (
        <>
          This isn&rsquo;t your account — the server is missing something it needs to
          complete a Google sign-in. Please report it; nothing you do will fix it.
        </>
      ),
    },
    OAuthCallback: {
      title: "Google sign-in didn't complete",
      body: (
        <>
          The handshake with Google failed on the way back. If retrying doesn&rsquo;t
          help, this is a server-side problem — please report it.
        </>
      ),
    },
    OAuthSignin: {
      title: "Couldn't start Google sign-in",
      body: <>Something went wrong before reaching Google. Please report it.</>,
    },
  };
  const shown = error ? (errorInfo[error] ?? {
    title: "Sign-in failed",
    body: <>Something went wrong. Please report it along with the code below.</>,
  }) : null;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "40px 24px",
        fontFamily: "var(--body)",
        color: "var(--ink)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: ACCENT,
            marginBottom: 14,
          }}
        >
          BU Spark!
        </div>
        <h1
          style={{
            fontFamily: "var(--display)",
            fontWeight: 700,
            fontSize: "clamp(28px, 5vw, 40px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "0 0 14px",
          }}
        >
          Sign in to see more.
        </h1>
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#55595e", margin: "0 0 28px" }}>
          Any BU account can sign in. You&rsquo;ll see projects that aren&rsquo;t public
          yet, and you can help fill in what&rsquo;s missing on the ones you worked on.
        </p>

        {shown && (
          <div
            role="alert"
            style={{
              border: "1px solid #dc262844",
              background: "#dc262810",
              borderRadius: 8,
              padding: "12px 14px",
              fontSize: 14,
              lineHeight: 1.55,
              color: "#991b1b",
              marginBottom: 20,
            }}
          >
            <strong>{shown.title}</strong>
            <div style={{ marginTop: 5 }}>{shown.body}</div>
            {/* The raw code, always. It is what makes a bug report actionable. */}
            <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 11.5, opacity: 0.75 }}>
              code: {error}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() =>
            signIn("google", {
              callbackUrl: safeCallback(rawCallback, window.location.origin, "/after-login"),
            })
          }
          style={{
            width: "100%",
            padding: "14px 18px",
            borderRadius: 8,
            border: "1px solid var(--field)",
            background: "#fff",
            fontFamily: "var(--body)",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--ink)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          Continue with BU Google
        </button>

        <p style={{ fontSize: 13, lineHeight: 1.6, color: "#8a8f94", margin: "22px 0 0" }}>
          Signing in doesn&rsquo;t give you edit access. Anything you submit is reviewed
          by the Spark! team before it appears.
        </p>
      </div>
    </main>
  );
}
