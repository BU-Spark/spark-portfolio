// Per-project page at /projects/[slug], rendered from the database (seed +
// admin-added projects alike), each with its own metadata for SEO/sharing.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getProject, getProjectForViewer, getProjectRedirect } from "@/lib/db";
import { auth } from "@/auth";

/**
 * A signed-in @bu.edu viewer may read `internal` projects as well as `public` ones.
 * Anonymous visitors keep the unstable_cache'd reader; signed-in ones take the
 * uncached viewer-scoped one, because the cache key is shared and would otherwise
 * hand an internal project to the next anonymous request.
 */
async function readProject(slug: string) {
  const session = await auth();
  return session?.user?.email ? getProjectForViewer(slug) : getProject(slug);
}
import { projectDisciplines } from "@/lib/project";
import { cleanBlurb } from "@/lib/gdocs";
import ProjectView from "@/components/ProjectView";
import { SITE_URL } from "@/lib/site";

const BASE = SITE_URL;

// One-line, length-bounded description for <meta>/OG/JSON-LD (the raw blurb has
// "•" bullets + newlines from the doc that don't belong in metadata).
function metaDescription(blurb: string): string {
  const s = cleanBlurb(blurb).replace(/\s+/g, " ").trim();
  return s.length > 200 ? s.slice(0, 197).trimEnd() + "…" : s;
}
// OG/JSON-LD consumers need absolute image URLs; imageUrl() returns "/api/img/…".
function absUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `${BASE}${u}`;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await readProject(slug);
  if (!p) return { title: "Project — BU Spark! Project Gallery" };
  const cover = p.images?.[0];
  const description = metaDescription(p.blurb);
  return {
    title: `${p.title} — BU Spark!`,
    description,
    openGraph: {
      title: `${p.title} — BU Spark!`,
      description,
      type: "article",
      ...(cover ? { images: [absUrl(cover)] } : {}),
    },
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await readProject(slug);
  if (!project) {
    // Slug may belong to a record that was merged away — 308 to the survivor.
    const to = await getProjectRedirect(slug);
    if (to && to !== slug) redirect(`/projects/${to}`);
    notFound();
  }

  const cover = project.images?.[0];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: project.title,
    description: metaDescription(project.blurb),
    url: `${BASE}/projects/${project.id}`,
    ...(cover ? { image: absUrl(cover) } : {}),
    creator: { "@type": "Organization", name: "BU Spark!" },
    keywords: projectDisciplines(project).join(", "),
  };
  const jsonLdHtml = JSON.stringify(jsonLd);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
      />
      <ProjectView project={project} />
    </>
  );
}
