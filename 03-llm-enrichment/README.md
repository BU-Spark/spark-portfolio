# Stage 3 — LLM Enrichment

Calls Claude API on each project's `description_text` to extract structured fields.

**Status:** not yet built.

**Input:** `../output/<year>/projects_cleaned.json`
**Output:** `../output/<year>/projects_enriched.json`

## Fields to extract

- `client_name` — actual client/organization name
- `client_type` — nonprofit | government | startup | enterprise | academic | other
- `problem_domain` — e.g. "criminal justice", "public health", "civic tech"
- `technical_approach` — e.g. "data pipeline", "web app", "ML model", "dashboard"
- `themes` — list of thematic tags for multi-dimensional slicing
- `one_line_summary` — single sentence suitable for a sales deck

## Notes

- Use few-shot prompting with 2–3 examples from known good project descriptions
- Ask for structured JSON output
- Consider prompt caching (descriptions are read-only; cache the system prompt)
- See `PIPELINE.md` for known doc quality issues — some inputs will be wrap-up
  docs with boilerplate before the project content; instruct Claude accordingly
