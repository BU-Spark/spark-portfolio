import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep the admin app, capability-token upload links, and API off search.
      disallow: ["/admin", "/contribute", "/api"],
    },
    sitemap: "https://sparkshowcase.vercel.app/sitemap.xml",
  };
}
