import type { MetadataRoute } from "next";
import { getProjects } from "@/lib/db";

export const dynamic = "force-dynamic";

const BASE = "https://sparkshowcase.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const projects = await getProjects();
  const now = new Date();
  return [
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    ...projects.map((p) => ({
      url: `${BASE}/projects/${p.id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
