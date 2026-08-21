// Standing data-quality audit. Runs lib/checks.ts over every project in the live
// database and prints what is wrong, what can be fixed mechanically, and which
// projects are most ready to be opted in to the public gallery.
//
// Read-only by default. Pass --fix-disciplines to apply the mechanical backfill; it
// only ever fills an EMPTY discipline and never overwrites a stored one.
//
//   npx tsx --env-file=.env.local db/audit-projects.ts
//   npx tsx --env-file=.env.local db/audit-projects.ts --fix-disciplines
//
// Talks to Postgres via `pg` directly and imports only PURE lib modules, matching the
// other scripts here: lib/db.ts is `server-only`, which is unresolvable outside
// Next's bundler, so importing it would make this unrunnable.
import { Pool } from "pg";
import { checkProject, hasBlocker, galleryReadiness } from "../lib/checks";
import type { Project, Run } from "../lib/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Only the columns the checks actually read, shaped into the Project fields they
// expect. Deliberately not a full rowToProject: this needs no PII and no derived
// role fields, and a narrow projection can't drift into leaking something.
interface Row {
  id: string;
  visibility: string | null;
  blurb: string | null;
  partner: string | null;
  tech: string[] | null;
  images: string[] | null;
  repo_url: string | null;
  prod_url: string | null;
  code_private: boolean | null;
  client_desc: string | null;
  topics: string[] | null;
  datasets: Project["datasets"] | null;
  runs: Run[] | null;
}

const toProject = (r: Row): Project =>
  ({
    id: r.id,
    title: r.id,
    visibility: r.visibility ?? "hidden",
    blurb: r.blurb ?? "",
    partner: r.partner ?? "",
    clientType: "",
    tech: r.tech ?? [],
    images: r.images ?? [],
    repoUrl: r.repo_url,
    prodUrl: r.prod_url,
    codePrivate: r.code_private ?? false,
    clientDesc: r.client_desc,
    topics: r.topics ?? [],
    datasets: r.datasets ?? [],
    runs: r.runs ?? [],
  }) as Project;

async function main() {
  const applyFixes = process.argv.includes("--fix-disciplines");
  const { rows } = await pool.query<Row>(
    `SELECT id, visibility, blurb, partner, tech, images, repo_url, prod_url,
            code_private, client_desc, topics, datasets, runs
       FROM projects ORDER BY id`
  );
  const projects = rows.map(toProject);
  const by = (v: string) => projects.filter((p) => p.visibility === v).length;

  const tally = new Map<string, number>();
  let blocked = 0;
  for (const p of projects) {
    const findings = checkProject(p);
    if (hasBlocker(findings)) blocked++;
    for (const f of findings) tally.set(f.code, (tally.get(f.code) ?? 0) + 1);
  }

  console.log(
    `projects ${projects.length} | hidden ${by("hidden")} | ready ${by("internal")} | ` +
      `public ${by("public")} | with a blocker ${blocked}`
  );

  console.log("\n--- findings by code ---");
  for (const [code, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(String(n).padStart(4), code);
  }

  const fixes = projects.flatMap((p) =>
    checkProject(p)
      .filter((f) => f.autoFix)
      .map((f) => ({ id: p.id, runs: p.runs, ...f.autoFix! }))
  );
  console.log(`\n--- mechanically fixable disciplines: ${fixes.length} ---`);
  for (const f of fixes) console.log(`  ${f.id.padEnd(34)} ${(f.runTerm || "—").padEnd(12)} -> ${f.to}`);

  if (applyFixes && fixes.length) {
    // Grouped by project: runs live in ONE jsonb array, so every fix for a project
    // must land in a single UPDATE or the last write drops the others.
    const byId = new Map<string, typeof fixes>();
    for (const f of fixes) byId.set(f.id, [...(byId.get(f.id) ?? []), f]);
    for (const [id, list] of byId) {
      const runs = list[0].runs.map((r) => {
        // Re-test emptiness against the row we're writing, so this stays correct even
        // if the same term appears twice.
        const hit = list.find((f) => f.runTerm === r.term && !(r.discipline ?? "").trim());
        return hit ? { ...r, discipline: hit.to } : r;
      });
      await pool.query(`UPDATE projects SET runs = $1::jsonb WHERE id = $2`, [
        JSON.stringify(runs),
        id,
      ]);
      console.log(`  fixed ${id} (${list.length} run${list.length === 1 ? "" : "s"})`);
    }
    console.log(`\napplied ${fixes.length} fix(es) across ${byId.size} project(s).`);
  } else if (fixes.length) {
    console.log("\n(read-only — re-run with --fix-disciplines to apply)");
  }

  // Opt-in shortlist. Blockers score 0, so anything with a score is safe to publish.
  const ranked = projects
    .filter((p) => p.visibility === "internal")
    .map((p) => ({ id: p.id, score: galleryReadiness(p) }))
    .sort((a, b) => b.score - a.score);
  console.log("\n--- most ready to publish (top 20) ---");
  for (const r of ranked.slice(0, 20)) console.log(String(r.score).padStart(3), r.id);

  const dist = ranked.reduce<Record<number, number>>((m, r) => {
    m[r.score] = (m[r.score] ?? 0) + 1;
    return m;
  }, {});
  console.log("\nscore distribution (score: count):", JSON.stringify(dist));
  console.log(`blocked from publishing (score 0): ${ranked.filter((r) => !r.score).length}`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await pool.end().catch(() => {});
    process.exit(1);
  });
