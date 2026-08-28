import { requireAdmin } from "@/lib/actor";
import { getDistinctTerms } from "@/lib/db";
import { SPARK_TERMS } from "@/lib/data";
import { semesterRank } from "@/lib/semester";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const dbTerms = await getDistinctTerms();
  // Merge SPARK_TERMS as a floor so future semesters (not yet in the DB) are
  // always selectable when creating the first project of a new term.
  const seen = new Set(dbTerms);
  const merged = [
    ...dbTerms,
    ...SPARK_TERMS.filter((t) => !seen.has(t)),
  ].sort((a, b) => semesterRank(b) - semesterRank(a));
  return Response.json({ terms: merged });
}
