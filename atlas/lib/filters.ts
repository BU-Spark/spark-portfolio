// Filter seed shape + URL-param parsing. Plain module (NO "use client") so the
// server gallery page can call parseFilterParams while the client useFilters
// hook reuses the same type.

export interface InitialFilters {
  query?: string;
  disciplines?: string[];
  programs?: string[];
  clientTypes?: string[];
  terms?: string[];
  topics?: string[];
  sort?: "term" | "az";
  view?: "grid" | "list";
}

// Parse Next.js searchParams (string | string[] | undefined per key) into the
// seed shape. Comma-joined facet lists; unknown sort/view values fall back.
export function parseFilterParams(
  sp: Record<string, string | string[] | undefined>
): InitialFilters {
  const one = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  const list = (v: string | string[] | undefined): string[] =>
    one(v)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const sortRaw = one(sp.sort);
  const viewRaw = one(sp.view);
  return {
    query: one(sp.q) || undefined,
    disciplines: list(sp.discipline),
    programs: list(sp.program),
    clientTypes: list(sp.clientType),
    terms: list(sp.term),
    topics: list(sp.topic),
    sort: sortRaw === "az" ? "az" : "term",
    view: viewRaw === "list" ? "list" : "grid",
  };
}
