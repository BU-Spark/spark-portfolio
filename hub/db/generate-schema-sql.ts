// Generate canonical schema.sql from the live DB (version-independent; uses
// pg_catalog for exact types + constraint defs).
//   npx tsx --env-file=.env.local db/generate-schema-sql.ts > schema.sql
//
// Lives in db/ rather than scripts/ because hub/.gitignore ignores `scripts/`
// wholesale — so the script that produces schema.sql (the file that claims to be
// the DDL source of truth) was itself untracked and existed only on one laptop.
// Anyone cloning the repo could read schema.sql but not regenerate it.
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tables = (
    await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
    )
  ).rows.map((r) => r.table_name);

  const out: string[] = [];
  out.push(`-- Canonical schema for the BU Spark! Project Gallery DB.`);
  out.push(`-- GENERATED from the live database by db/generate-schema-sql.ts — do not hand-edit.`);
  out.push(`-- Regenerate after any migration. This is the source-of-truth DDL + the Database++ seed contract.\n`);

  for (const t of tables) {
    // NOT NULL now lives as contype='n' constraints in PG18; fold them back inline.
    const notnullCols = new Set(
      (
        await pool.query(
          `SELECT a.attname FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
            WHERE c.conrelid=$1::regclass AND c.contype='n'`,
          [t],
        )
      ).rows.map((r) => r.attname),
    );
    const cols = (
      await pool.query(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull notnull,
                pg_get_expr(d.adbin, d.adrelid) def
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE a.attrelid = $1::regclass AND a.attnum>0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [t],
      )
    ).rows;

    const lines = cols.map((c) => {
      const seq = c.def && /nextval\(/.test(c.def);
      if (seq && c.typ === "bigint") return `  ${c.attname} bigserial`;
      if (seq && c.typ === "integer") return `  ${c.attname} serial`;
      let s = `  ${c.attname} ${c.typ}`;
      if (c.notnull || notnullCols.has(c.attname)) s += " NOT NULL";
      if (c.def) s += ` DEFAULT ${c.def}`;
      return s;
    });
    out.push(`CREATE TABLE IF NOT EXISTS ${t} (\n${lines.join(",\n")}\n);`);

    // Real constraints (PK / FK / UNIQUE / CHECK) via authoritative def; skip
    // NOT NULL ('n') — folded inline above.
    const cons = (
      await pool.query(
        `SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
          WHERE conrelid=$1::regclass AND contype<>'n' ORDER BY contype DESC, conname`,
        [t],
      )
    ).rows;
    const conNames = new Set(cons.map((c) => c.conname));
    for (const c of cons)
      out.push(`ALTER TABLE ${t} ADD CONSTRAINT ${c.conname} ${c.def};`);

    // non-constraint indexes only
    const idx = (
      await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`, [t])
    ).rows;
    for (const i of idx) if (!conNames.has(i.indexname)) out.push(`${i.indexdef};`);
    out.push("");
  }
  console.log(out.join("\n"));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
