// Pure semester ranking — kept out of the (server-only) import route so it's
// unit-testable. Ranks a "Season YYYY" string so the PD importer can keep the
// LATEST semester's blurb: later calendar term → higher number; unparseable → 0.
const TERM_IDX: Record<string, number> = { spring: 1, summer: 2, fall: 3 };

export function semesterRank(semester: string | undefined | null): number {
  const m = (semester || "").match(/(spring|summer|fall)\s*(\d{4})/i);
  if (!m) return 0;
  return parseInt(m[2], 10) * 10 + (TERM_IDX[m[1].toLowerCase()] || 0);
}
