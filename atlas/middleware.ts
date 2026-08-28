// Gate /admin behind auth using the edge-safe config. The `authorized` callback
// in auth.config.ts decides; unauthenticated users are redirected to the login.
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/admin/:path*"],
};
