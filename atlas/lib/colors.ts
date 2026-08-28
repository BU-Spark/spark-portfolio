// Discipline color coding — a PURE module (no "use client") so both client
// components (Gallery, via lib/shared) and server components (ProjectView) can
// call disciplineColor(). It used to live in the "use client" lib/shared.tsx,
// which broke once ProjectView became a server component ("can't call a client
// function from the server"). lib/shared re-exports these for existing importers.

// Harmonious set: fixed lightness/chroma in oklch, hue varied per discipline.
export const DISCIPLINE_COLORS: Record<string, string> = {
  UX: "oklch(0.64 0.15 25)",
  SWE: "oklch(0.62 0.14 255)",
  ML: "oklch(0.60 0.16 305)",
  "Data Visualization": "oklch(0.66 0.13 205)",
  "Data Science": "oklch(0.64 0.13 160)",
  Innovation: "oklch(0.70 0.14 75)",
  "Justice Media Co-Lab": "oklch(0.62 0.15 350)",
  Misc: "oklch(0.62 0.03 260)",
};

export function disciplineColor(d: string): string {
  return DISCIPLINE_COLORS[d] || "oklch(0.6 0.03 260)";
}

// Short tag used on thumbnails
export const DISCIPLINE_ABBR: Record<string, string> = {
  UX: "UX",
  SWE: "SWE",
  ML: "ML",
  "Data Visualization": "DATAVIZ",
  "Data Science": "DATA SCI",
  Innovation: "INNOV",
  "Justice Media Co-Lab": "JMC",
  Misc: "MISC",
};
