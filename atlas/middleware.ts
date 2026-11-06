// Gate /admin behind auth using the edge-safe config. The `authorized` callback
// in auth.config.ts decides; unauthenticated users are redirected to the login.
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// ponytail: kept as middleware.ts (edge), not proxy.ts (Node) — OpenNext on Workers runs edge middleware only.
const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  matcher: ["/admin/:path*"],
};
