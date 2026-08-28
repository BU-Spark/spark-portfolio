// CDS-skinned project gallery. Reads the SAME database as the main Spark gallery,
// showing only projects tagged with the "cds" surface (internal admin tag). A
// project can be surfaced on Spark, CDS, or both. Distinct CDS visual identity.
import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import CDSGallery, { type CdsProject } from "@/components/CDSGallery";
import { getProjects } from "@/lib/db";
import { primaryDiscipline, primaryRun, latestTerm } from "@/lib/project";
import { courseLabel } from "@/lib/data";
import { cleanBlurb } from "@/lib/gdocs";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-fraunces",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

// Always reflect the latest DB state (small dataset, low traffic).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BU CDS — Project Gallery",
  description:
    "Student-built, data-driven projects from BU's Faculty of Computing & Data Sciences.",
};

export default async function CDSPage() {
  const all = await getProjects();
  // Only projects tagged for the CDS surface. Map the real (runs-based) Project
  // onto the flat shape the CDS gallery renders. Never exposes admin-only fields.
  const projects: CdsProject[] = all
    .filter((p) => (p.surfaces ?? ["spark"]).includes("cds"))
    .map((p) => ({
      id: p.id,
      title: p.title,
      discipline: primaryDiscipline(p),
      topics: p.topics ?? [],
      term: latestTerm(p),
      program: courseLabel(primaryRun(p)?.course ?? ""),
      partner: p.partner,
      partnerUrl: p.clientUrl ?? undefined,
      clientDesc: p.clientDesc ?? undefined,
      clientType: p.clientType,
      blurb: cleanBlurb(p.blurb),
      tech: p.tech,
    }));

  return (
    <div className={`${fraunces.variable} ${inter.variable}`}>
      <CDSGallery projects={projects} />
    </div>
  );
}
