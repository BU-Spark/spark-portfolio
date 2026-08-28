// The one sign-in surface, for everyone. Styled to the PUBLIC gallery (globals.css
// tokens, IBM Plex / Space Grotesk) rather than the dark Spark Control rail — most
// people arriving here are BU viewers, not admins, and /admin/login's "approved
// admins only" framing actively misdescribes what signing in now gets you.
//
// It is deliberately dumb: one button, one provider. There is nothing to gate here
// because signing in grants only BU-tier reads; admin authority is resolved
// per-request by actor() and cannot be obtained from this page.
import { Suspense } from "react";
import type { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Sign in · BU Spark! Project Gallery",
  // Signed-in-only views are not for crawlers, and neither is the door to them.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    // useSearchParams (for callbackUrl and ?error=) needs a Suspense boundary or
    // Next refuses to build the route.
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
