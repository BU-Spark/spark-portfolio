"use client";
// Signed-in state in the public masthead.
//
// Added because opening sign-in to the whole @bu.edu domain created a state that
// previously could not exist: someone browsing the PUBLIC gallery while holding a
// session. Before, a session meant admin, and admins live under /admin where the
// rail shows who they are and offers a way out. A BU viewer had neither — no
// indication they were seeing extra projects, and no way to sign out at all.
//
// That matters beyond convenience. A viewer who doesn't know they're signed in
// can't tell that the internal projects they can see are NOT public, which is
// exactly the confusion the state pills exist to prevent.
//
// Deliberately not a nav: the masthead comment says this component carries no
// navigation of its own so it can be embedded under buspark.io later. This is
// session state, not navigation.
//
// Takes the email as a PROP rather than calling useSession(). The server component
// above already resolved the session to choose which project reader to use, so a
// SessionProvider would wrap the whole app in a client context and add a
// /api/auth/session round trip on every page load to re-learn what the server
// already knew. signIn/signOut are standalone and need no provider.
import { signIn, signOut } from "next-auth/react";

const ACCENT = "#0fa392";

const linkStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11.5,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#55595e",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
};

export default function AuthStrip({ email }: { email?: string | null }) {
  if (!email) {
    return (
      <button type="button" onClick={() => signIn("google")} style={linkStyle} title="BU accounts only">
        Sign in
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: ACCENT,
          whiteSpace: "nowrap",
        }}
        title={`Signed in as ${email}. You can see projects that aren't public yet.`}
      >
        BU view
      </span>
      <button type="button" onClick={() => signOut({ callbackUrl: "/" })} style={linkStyle}>
        Sign out
      </button>
    </div>
  );
}
