// Gallery root — server-rendered from the database, so admin additions are
// visible to every visitor. Gallery itself is a client component (filters/
// search); it receives the project list as a prop.
import Gallery from "@/components/Gallery";
import {
  getProjects,
  getProjectsForViewer,
  getGallerySettings,
  getDistinctTerms,
  countStudentExperiences,
} from "@/lib/db";
import { parseFilterParams } from "@/lib/filters";
import { auth } from "@/auth";

// Always reflect the latest DB state (small dataset, low traffic).
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  // Next 15: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // BU tier: a signed-in @bu.edu viewer additionally sees `internal` projects.
  // Resolved from the session ONLY — no DB lookup, because "is signed in" is the
  // whole condition; admin authority is a separate question answered by actor().
  //
  // The two readers are separate functions on purpose: getProjects is
  // unstable_cache'd under a shared, session-independent key, so a viewer-aware
  // branch inside it would serve one visitor's rows to everybody.
  const session = await auth();
  const signedIn = !!session?.user?.email;
  const [projects, settings, terms, students, sp] = await Promise.all([
    signedIn ? getProjectsForViewer() : getProjects(),
    getGallerySettings(),
    getDistinctTerms(),
    countStudentExperiences(),
    searchParams,
  ]);
  const initialFilters = parseFilterParams(sp);
  // Only projects tagged for the Spark! surface (default). CDS-only projects
  // live at /cds; a project tagged for both appears in both galleries.
  const sparkProjects = projects.filter((p) => (p.surfaces ?? ["spark"]).includes("spark"));
  return (
    <div style={{ minHeight: "100vh" }}>
      <Gallery
        projects={sparkProjects}
        initialFilters={initialFilters}
        settings={settings}
        terms={terms}
        studentExperiences={students}
      />
    </div>
  );
}
