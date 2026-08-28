// Tech-stack extraction from a PD "Tech Stack / Design system Used" table cell.
// Kept pure + runtime-agnostic (like lib/gdocs.ts) so both the bulk Apps Script
// import path and the browser PdBlurbFetch path can share it, and it's unit-
// testable in isolation.
//
// The cell comes in two real shapes (see the PD docs):
//   • a clean list   — "• ArcGIS\n• Python"            → each item IS a tag
//   • prose          — "Client prefer R but okay with Python (FA25 used Python)"
//                       (often still inside ONE bullet) → tokenize against a
//                       curated dictionary; don't treat the sentence as a tag
// We classify PER ITEM, not per cell, because a bullet can hold a sentence.

// Curated allowlist of technologies seen across Spark projects. `label` is the
// canonical display tag; `re` matches it in prose. Extend freely — order doesn't
// matter (we dedupe by label). Single-letter langs ("R") are case-SENSITIVE and
// word-bounded so they don't match inside other words.
const TECH_DICTIONARY: { label: string; re: RegExp }[] = [
  { label: "Python", re: /\bpython\b/i },
  { label: "R", re: /\bR\b/ }, // case-sensitive: standalone uppercase R only
  { label: "JavaScript", re: /\bjavascript\b/i },
  { label: "TypeScript", re: /\btypescript\b/i },
  { label: "React", re: /\breact(?:\.js)?\b/i },
  { label: "Next.js", re: /\bnext\.?js\b/i },
  { label: "Node.js", re: /\bnode\.?js\b/i },
  { label: "Vue", re: /\bvue(?:\.js)?\b/i },
  { label: "Angular", re: /\bangular\b/i },
  { label: "Svelte", re: /\bsvelte\b/i },
  { label: "D3.js", re: /\bd3(?:\.js)?\b/i },
  { label: "Pandas", re: /\bpandas\b/i },
  { label: "NumPy", re: /\bnumpy\b/i },
  { label: "scikit-learn", re: /\bscikit[- ]?learn\b|\bsklearn\b/i },
  { label: "TensorFlow", re: /\btensorflow\b/i },
  { label: "PyTorch", re: /\bpytorch\b/i },
  { label: "Flask", re: /\bflask\b/i },
  { label: "Django", re: /\bdjango\b/i },
  { label: "FastAPI", re: /\bfastapi\b/i },
  { label: "Streamlit", re: /\bstreamlit\b/i },
  { label: "Jupyter", re: /\bjupyter\b/i },
  { label: "PostgreSQL", re: /\bpostgres(?:ql)?\b/i },
  { label: "MySQL", re: /\bmysql\b/i },
  { label: "MongoDB", re: /\bmongo(?:db)?\b/i },
  { label: "SQLite", re: /\bsqlite\b/i },
  { label: "SQL", re: /\bsql\b/i },
  { label: "ArcGIS", re: /\barcgis\b/i },
  { label: "QGIS", re: /\bqgis\b/i },
  { label: "GeoPandas", re: /\bgeopandas\b/i },
  { label: "Leaflet", re: /\bleaflet\b/i },
  { label: "Mapbox", re: /\bmapbox\b/i },
  { label: "Tableau", re: /\btableau\b/i },
  { label: "Power BI", re: /\bpower\s?bi\b/i },
  { label: "Figma", re: /\bfigma\b/i },
  { label: "AWS", re: /\baws\b|\bamazon web services\b/i },
  { label: "GCP", re: /\bgcp\b|\bgoogle cloud\b/i },
  { label: "Azure", re: /\bazure\b/i },
  { label: "Docker", re: /\bdocker\b/i },
  { label: "Kubernetes", re: /\bkubernetes\b|\bk8s\b/i },
  { label: "Hugging Face", re: /\bhugging\s?face\b/i },
  { label: "LangChain", re: /\blangchain\b/i },
  { label: "OpenAI", re: /\bopenai\b/i },
  { label: "Spark", re: /\bapache spark\b|\bpyspark\b/i },
  { label: "Hadoop", re: /\bhadoop\b/i },
  { label: "Java", re: /\bjava\b/i },
  { label: "C++", re: /\bc\+\+\b/i },
  { label: "C#", re: /\bc#/i },
  { label: "Swift", re: /\bswift\b/i },
  { label: "Kotlin", re: /\bkotlin\b/i },
  { label: "Go", re: /\bgolang\b/i }, // "Go" alone is too noisy; require "golang"
  { label: "Rust", re: /\brust\b/i },
  { label: "HTML", re: /\bhtml5?\b/i },
  { label: "CSS", re: /\bcss3?\b/i },
  { label: "Tailwind", re: /\btailwind\b/i },
  { label: "FastText", re: /\bfasttext\b/i },
  { label: "spaCy", re: /\bspacy\b/i },
  { label: "NLTK", re: /\bnltk\b/i },
];

// Sentence "tells" — function words that mean an item is prose, not a tag.
const PROSE_WORDS =
  /\b(and|or|but|with|the|a|an|to|of|for|is|are|prefer(?:s|red)?|okay|ok|client|team|worked?|using|used|use|like|either|both|maybe|possibly|should|would|could)\b/i;

const BULLET_RE = /^[\s]*[*•●○▪◦‣·\-–—]\s+/;

function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

// Match dictionary entries within a prose fragment, preserving dictionary order.
function matchDictionary(text: string): string[] {
  return TECH_DICTIONARY.filter((d) => d.re.test(text)).map((d) => d.label);
}

// Decide if a single (already bullet-stripped) item is a clean literal tag vs a
// sentence. Clean = short and free of prose function words / sentence punctuation.
function isLiteralTag(item: string): boolean {
  const words = item.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  if (/[.;:]|\bhttps?:\/\//i.test(item)) return false;
  if (PROSE_WORDS.test(item)) return false;
  return true;
}

// Tidy a literal tag: drop trailing parenthetical notes, surrounding quotes,
// trailing punctuation; collapse whitespace. Cap length defensively.
function cleanTag(item: string): string {
  return item
    .replace(/\([^)]*\)/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export interface TechParse {
  tags: string[]; // extracted technology tags (deduped, order-preserved)
  raw: string; // the original cell text, kept for the admin-only note
  mode: "list" | "prose" | "empty"; // how the tags were derived
}

/**
 * Parse a PD Tech-Stack cell into discrete tags. List items shaped like real
 * tags are taken verbatim; sentence-shaped items (even bulleted ones) are run
 * through the curated dictionary so prose like "Client prefer R but okay with
 * Python" yields ["R", "Python"] rather than the whole sentence.
 *
 * Items may be comma/"and"-separated within a single line, so we split those
 * out before classifying. Returns the raw cell too, so callers can store it as
 * an admin-only note and never lose the original nuance.
 */
export function parseTechStack(cellText: string): TechParse {
  const raw = (cellText || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return { tags: [], raw: "", mode: "empty" };

  const lines = raw
    .split("\n")
    .map((l) => l.replace(BULLET_RE, "").trim())
    .filter(Boolean);

  const literal: string[] = [];
  const fromProse: string[] = [];

  for (const line of lines) {
    // A short line might be a comma/"and"-joined list of tags ("Python, R, SQL").
    const parts = line
      .split(/\s*,\s*|\s+and\s+|\s*\/\s*|\s*;\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
    // Only treat as a delimited tag-list if EVERY part is itself a clean tag —
    // otherwise it's prose that merely happens to contain a comma.
    const splittable = parts.length > 1 && parts.every(isLiteralTag);
    const items = splittable ? parts : [line];

    for (const item of items) {
      // Classify on the note-stripped form ("Python (preferred)" → "Python" is a
      // clean tag), but dictionary-match the ORIGINAL so tokens inside a note
      // still count toward prose extraction.
      const stripped = item.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      if (stripped && isLiteralTag(stripped)) {
        const t = cleanTag(item);
        if (t) literal.push(t);
      } else {
        fromProse.push(...matchDictionary(item));
      }
    }
  }

  const tags = dedupe([...literal, ...fromProse]);
  const mode: TechParse["mode"] = literal.length ? "list" : "prose";
  return { tags, raw, mode };
}
