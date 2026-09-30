# Stage 4 — Slide Generator

Generates a polished one-slide recap per project for use in sales decks.

**Status:** not yet built.

**Input:** `../output/<year>/projects_enriched.json` + `../output/<year>/deliverables/`
**Output:** `../output/<year>/slides/<project_slug>/recap.png` (or .pptx)

## Approach

1. Extract text/structure from downloaded PPTX or PDF deliverable
   - `python-pptx` for PPTX slides
   - `pymupdf` (fitz) for PDF pages
2. Feed extracted content + enriched description to Claude to produce:
   - Client and problem statement
   - What was built / technical approach
   - Key outcomes or highlights pulled from the actual deliverable
3. Render a new slide using a SPARK-branded template via `python-pptx`

## Slide content target

- Client name + logo placeholder
- One-sentence problem statement
- 3-bullet approach / what was built
- 1-2 outcome highlights from the deliverable
- Course / semester tag

## Notes

- "Pull one slide" from the deliverable is low-value — generating a new slide
  that synthesizes description + deliverable content is the goal
- Template should match SPARK brand guidelines
- Consider generating both a standalone PNG (for embedding) and a .pptx slide
  (for insertion into existing decks)
