// Gallery settings — the admin-editable discipline/client-type vocabularies and
// which facets show in the sidebar.
//   GET  → current settings (public; the gallery + admin forms read it)
//   PUT  → save settings (admin session required)
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { getGallerySettings, saveGallerySettings } from "@/lib/db";
import type { GallerySettings } from "@/lib/types";

export async function GET() {
  return Response.json(await getGallerySettings());
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Partial<GallerySettings>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  // Sanitize: trim, drop blanks, de-dupe; coerce facet flags to booleans.
  const clean = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? Array.from(
          new Set(
            arr.map((x) => String(x).trim()).filter((x) => x.length > 0)
          )
        )
      : [];

  const current = await getGallerySettings();
  const next: GallerySettings = {
    disciplines: clean(body.disciplines).length
      ? clean(body.disciplines)
      : current.disciplines,
    clientTypes: clean(body.clientTypes).length
      ? clean(body.clientTypes)
      : current.clientTypes,
    programs: clean(body.programs).length ? clean(body.programs) : current.programs,
    topics: clean(body.topics).length ? clean(body.topics) : current.topics,
    facetOrder:
      Array.isArray(body.facetOrder) && body.facetOrder.length
        ? (body.facetOrder.filter((k) =>
            ["discipline", "topic", "program", "clientType", "term"].includes(String(k)),
          ) as GallerySettings["facetOrder"])
        : current.facetOrder,
    showFacets: {
      discipline: Boolean(body.showFacets?.discipline ?? current.showFacets.discipline),
      topic: Boolean(body.showFacets?.topic ?? current.showFacets.topic),
      program: Boolean(body.showFacets?.program ?? current.showFacets.program),
      clientType: Boolean(body.showFacets?.clientType ?? current.showFacets.clientType),
      term: Boolean(body.showFacets?.term ?? current.showFacets.term),
    },
    courseNames:
      body.courseNames !== null &&
      typeof body.courseNames === "object" &&
      !Array.isArray(body.courseNames)
        ? (body.courseNames as Record<string, string>)
        : current.courseNames,
    intro:
      body.intro && typeof body.intro === "object"
        ? {
            eyebrow: String(body.intro.eyebrow ?? current.intro?.eyebrow ?? "").trim(),
            heading: String(body.intro.heading ?? current.intro?.heading ?? "").trim(),
            body: String(body.intro.body ?? current.intro?.body ?? "").trim(),
          }
        : current.intro,
    heroStats: Array.isArray(body.heroStats)
      ? body.heroStats.map((s) => {
          const raw = (s as { value?: unknown })?.value;
          const value =
            raw === "" || raw == null || !Number.isFinite(Number(raw))
              ? undefined
              : Number(raw);
          return {
            show: Boolean(s?.show),
            metric: s?.metric === "students" ? ("students" as const) : ("projects" as const),
            text: String(s?.text ?? "").trim(),
            ...(value === undefined ? {} : { value }),
          };
        })
      : current.heroStats,
    thumbBadge: ["discipline", "course", "program"].includes(String(body.thumbBadge))
      ? (body.thumbBadge as GallerySettings["thumbBadge"])
      : current.thumbBadge,
  };

  await saveGallerySettings(next);
  revalidateTag("gallery-settings");
  revalidateTag("projects"); // discipline/clientType vocab affects gallery facets
  return Response.json({ ok: true, settings: next });
}
