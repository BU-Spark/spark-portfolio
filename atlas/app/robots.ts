import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep the admin app, capability-token upload links, and API off search.
      disallow: ["/admin", "/contribute", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
