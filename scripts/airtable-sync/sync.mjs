#!/usr/bin/env node
// Nightly Atlas -> Airtable sync for the "Atlas End-of-Semester" base.
//
// Reads /api/ops/airtable-export (bearer DIGEST_TOKEN) and upserts one row per
// project into the base's Projects table, keyed on "Atlas ID".
//
// Ownership: Atlas owns identity fields (name, semester, course, team, client
// org, PM email). Airtable owns what its forms write (Status after a PM
// submits, every Consent field). So Status is only written when the Airtable
// row has none yet, and consent fields are never touched.
//
// THE REPO IS PUBLIC, SO ARE ACTIONS LOGS: log counts and field names only,
// never a name, email or team id.
//
// Usage: node sync.mjs            (writes)
//        DRY_RUN=1 node sync.mjs  (reads both sides, reports, writes nothing)
//        node sync.mjs --self-check
import assert from "node:assert/strict";

const FIELDS = {
  id: "Atlas ID", name: "Name", semester: "Semester", course: "Course", team: "Team",
  clientOrg: "Client Org", pmEmail: "PM Email", status: "Status", current: "Current Semester",
};
const STATUS = { pending: "Pending", active: "Active", in_review: "In Review", complete: "Complete" };

export function currentTerm(d) {
  const m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  return m >= 8 ? `Fall ${y}` : m >= 5 ? `Summer ${y}` : `Spring ${y}`;
}

// rows: export rows. existing: Map atlasId -> { status }. names: FIELDS key -> actual Airtable field name.
export function buildRecords(rows, existing, names, term) {
  return rows.map((r) => {
    const f = {
      [names.id]: r.id,
      [names.name]: r.name,
      [names.semester]: r.semester || null,
      [names.course]: r.course,
      [names.team]: r.team,
      [names.clientOrg]: r.clientOrg,
      [names.pmEmail]: r.pmEmail || null,
      [names.current]: r.semester === term,
    };
    if (!existing.get(r.id)?.status) f[names.status] = STATUS[r.status] ?? "Pending";
    return { fields: f };
  });
}

// Resolve our field names against the real table, forgiving case and spacing.
export function resolveFields(tableFields) {
  const byKey = new Map(tableFields.map((f) => [f.name.trim().toLowerCase(), f.name]));
  const names = {}, missing = [];
  for (const [k, want] of Object.entries(FIELDS)) {
    const got = byKey.get(want.toLowerCase());
    if (got) names[k] = got; else missing.push(want);
  }
  return { names, missing };
}

function selfCheck() {
  assert.equal(currentTerm(new Date("2026-09-26")), "Fall 2026");
  assert.equal(currentTerm(new Date("2026-06-01")), "Summer 2026");
  assert.equal(currentTerm(new Date("2026-02-01")), "Spring 2026");
  const { names, missing } = resolveFields(Object.values(FIELDS).map((n) => ({ name: n.toUpperCase() + " " })));
  assert.deepEqual(missing, []);
  const rows = [
    { id: "a", name: "A", semester: "Fall 2026", course: "DS519", team: "t", clientOrg: "Org", pmEmail: "", status: "active" },
    { id: "b", name: "B", semester: "Spring 2025", course: "", team: "", clientOrg: "", pmEmail: "x@bu.edu", status: "complete" },
  ];
  const recs = buildRecords(rows, new Map([["b", { status: "Active" }]]), names, "Fall 2026");
  assert.equal(recs[0].fields[names.status], "Active", "new row gets Atlas status");
  assert.equal(recs[0].fields[names.current], true);
  assert.equal(recs[0].fields[names.pmEmail], null, "blank email is cleared, not written as empty string");
  assert.ok(!(names.status in recs[1].fields), "existing Airtable status is never overwritten");
  assert.equal(recs[1].fields[names.current], false);
  const { missing: miss2 } = resolveFields([{ name: "Atlas ID" }]);
  assert.ok(miss2.includes("Semester"));
  console.log("self-check OK");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function airtable(path, init = {}) {
  const res = await fetch(`https://api.airtable.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Airtable ${init.method || "GET"} ${path.split("?")[0]} -> ${res.status} ${body?.error?.type || ""}`);
  return body;
}

async function main() {
  const need = ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "DIGEST_TOKEN"].filter((k) => !process.env[k]);
  if (need.length) throw new Error(`missing env: ${need.join(", ")}`);
  const base = process.env.AIRTABLE_BASE_ID.trim();
  const origin = (process.env.ATLAS_ORIGIN || "https://atlas.buspark.io").replace(/\/$/, "");
  const dry = !!process.env.DRY_RUN;

  const exp = await fetch(`${origin}/api/ops/airtable-export`, { headers: { Authorization: `Bearer ${process.env.DIGEST_TOKEN}` } });
  if (!exp.ok) throw new Error(`Atlas export -> ${exp.status}`);
  const { projects } = await exp.json();
  console.log(`Atlas: ${projects.length} projects`);

  const { tables } = await airtable(`/v0/meta/bases/${base}/tables`);
  const table = tables.find((t) => t.name.trim().toLowerCase() === "projects");
  if (!table) throw new Error(`no "Projects" table; tables are: ${tables.map((t) => t.name).join(", ")}`);
  const { names, missing } = resolveFields(table.fields);
  if (missing.length) throw new Error(`Projects is missing fields: ${missing.join(", ")}. It has: ${table.fields.map((f) => f.name).join(", ")}`);
  console.log(`Airtable: Projects table found, all ${Object.keys(FIELDS).length} fields resolved`);

  const existing = new Map();
  let offset;
  do {
    const q = new URLSearchParams();
    q.append("fields[]", names.id); q.append("fields[]", names.status);
    if (offset) q.set("offset", offset);
    const page = await airtable(`/v0/${base}/${table.id}?${q}`);
    for (const r of page.records) {
      const id = r.fields[names.id];
      if (id) existing.set(id, { status: r.fields[names.status] || "" });
    }
    offset = page.offset;
    await sleep(220);
  } while (offset);

  const term = currentTerm(new Date());
  const records = buildRecords(projects, existing, names, term);
  const creates = projects.filter((p) => !existing.has(p.id)).length;
  console.log(`plan: ${creates} to create, ${projects.length - creates} to update, current term ${term}`);
  if (dry) { console.log("DRY_RUN: nothing written"); return; }

  for (let i = 0; i < records.length; i += 10) {
    await airtable(`/v0/${base}/${table.id}`, {
      method: "PATCH",
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn: [names.id] }, records: records.slice(i, i + 10), typecast: true }),
    });
    await sleep(220); // Airtable allows 5 requests/second per base
  }
  console.log(`wrote ${records.length} rows`);
}

if (process.argv.includes("--self-check")) selfCheck();
else main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
