# Spark Portfolio — Operating Guide

## What this repository is

`spark-portfolio` is the monorepo for the Spark Project Portfolio program. It
contains a shared `spine/` (the schema and data-model contract) and individual
initiatives that read from and contribute to that contract.

See `README.md` for the current program layout.

## Working in the monorepo

- Work in the subdirectory for your initiative: `spine/`, `hub/`,
  `drive-walker/`, or `semantic-extraction/`.
- Read `spine/` before extending an initiative's data model. Integration happens
  through the shared spine.
- Keep implementation within its initiative directory. Move existing code into
  that directory rather than leaving it scattered across external repositories
  or ad-hoc locations.
- Read an initiative's own `OPS.md` when it exists before changing that
  initiative. `AGENTS.md` and `CLAUDE.md` are entry-point pointers, not
  canonical policy files.

## Git and GitHub

- Use a feature branch and open a pull request for changes; do not commit
  directly to `main`.
- Use the `gh` CLI for GitHub operations.
- Stage explicit paths and preserve unrelated working-tree changes.
- For multi-line GitHub bodies, write the text to a temporary file and use the
  relevant `--body-file` option.

## Agent commit attribution

For an attributable agent commit, use a co-author trailer that names the
producing project and the actual model that made the change:

```
Co-Authored-By: spark-portfolio / <actual model> <noreply@openai.com>
```

Do not use a stale parent-agent or model identity. Mechanical edits may omit the
trailer.
