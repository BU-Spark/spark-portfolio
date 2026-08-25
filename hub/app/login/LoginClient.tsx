"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

const ACCENT = "#0fa392";

import { safeCallback } from "@/lib/callback";

export default function LoginClient() {
  const params = useSearchParams();
  const callbackUrl = safeCallback(params.get("callbackUrl"), window.location.origin);
  // Auth.js sets ?error=AccessDenied when the signIn callback returns false, which
  // now happens for exactly one reason: the address is not @bu.edu.
  const denied = params.get("error") === "AccessDenied";

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

        {denied && (
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
            That account isn&rsquo;t a BU address. Sign in with your{" "}
            <strong>@bu.edu</strong> Google account — a personal Gmail won&rsquo;t work.
          </div>
        )}

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
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
