# Project Portfolio — Project Page Content Requirements

**Audience:** Lydia, Ziba (operations)
**Purpose:** Define what information appears on each individual project page in the
Spark! Project Gallery, and who can see each piece.
**Scope:** Historical / past projects only. (This does **not** cover the separate
proposal to reuse the gallery as an operational hub for *active* projects.)

This document is about **content**, not layout or visuals. It answers two questions
for every project page:
1. What information do we show?
2. Who is allowed to see it?

---

## Visibility levels

Every field below is tagged with one of two levels:

- **Public** — visible to anyone on the internet, no login. This is the project's
  public showcase entry.
- **Staff-only** — visible **only** when signed in with an authorized Spark! account.
  This information is never shown to the public and is never included in anything the
  public page sends to a browser.

> **Hard rule:** Student names and internal team identifiers are Staff-only and must
> never appear publicly.

---

## Public content (anyone can see)

| # | Content | What it is | Required? | Notes |
|---|---------|-----------|-----------|-------|
| 1 | **Project title** | The official project name | Required | — |
| 2 | **Description / overview** | A short (1–2 paragraph) summary of what the project is and does | Required | Plain text. This is the main written content of the page. |
| 3 | **Discipline(s)** | The area(s) of work, e.g. UX, Software Engineering, Machine Learning, Data Science, Data Visualization, Innovation | Required | A project can span more than one discipline across its semesters. |
| 4 | **Client / partner name** | The organization the project was built for | Optional | Some internal projects have no external client. |
| 5 | **Client type** | The kind of partner, e.g. Nonprofit, Industry, Government, Internal | Optional | Shown only when a client is present. |
| 6 | **Semester history ("Where it ran")** | Each semester the project ran, with its course and discipline for that term | Required | A project may run across multiple semesters; each is listed. Drives the "last active" sense of the project. |
| 7 | **Technologies used** | The tech stack, e.g. React, Python, PostgreSQL | Optional | Shown as a list of tags. |
| 8 | **Project images / screenshots** | Up to four images; the first is the cover | Optional | If a project has no images, a neutral placeholder is shown instead. |
| 9 | **Source code link** | Link to the public code repository (e.g. GitHub) | Optional | Shown as a "View project" link. |
| 10 | **Live / demo link** | Link to a live site or demo, if one exists | Optional | Shown as a "View live" link. |

**Public content requirements**
- Title, description, discipline, and at least one semester are the minimum for a
  project to be shown publicly. (A project missing these stays hidden until completed.)
- A project can be marked as a **draft** — drafts are hidden from the public entirely.
- A project can be **featured** — featured projects are highlighted in the gallery.
- Links must be real web addresses and open in a new tab.

---

## Staff-only content (requires login)

This information exists for internal use and is shown **only** to signed-in Spark! staff.
It is never visible to the public.

| # | Content | What it is | Notes |
|---|---------|-----------|-------|
| A | **Student contributors** | The students on the team — name, GitHub username, BU email | Tracked per semester, because a project's team usually changes each term. **Never public.** |
| B | **Team roles** | Who held each role that semester: Program Lead, PM, TPM, Senior Advisor, Tech Advisor, EIR, and class instructor(s) | Tracked per semester. **Never public.** |
| C | **Project contact(s)** | Named point(s) of contact with email | For internal follow-up. **Never public.** |
| D | **Project Description document** | Link to the semester's PD doc | Internal reference. **Never public.** |
| E | **Project Drive folder** | Link to the project's shared Google Drive folder | Internal reference. **Never public.** |
| F | **Internal team identifier** | An internal reference ID used to tie records together | Bookkeeping only. **Never public.** |

**Staff-only content requirements**
- All of the above is gated behind login. A logged-out visitor sees none of it, and it
  is not sent to their browser in any form.
- These fields are optional per project and are filled in by staff over time.

---

## Summary for reviewers

- The **public page** tells the story of a project: what it is, who it was for, the
  disciplines and technologies involved, when it ran, images, and links to the code and
  any live demo.
- The **staff-only layer** adds the operational detail: who worked on it, who to contact,
  and links to internal documents.
- The dividing line is strict: **anything identifying students, contacts, internal
  documents, or internal IDs is staff-only** and never leaves the login wall.

*Open question for Lydia & Ziba: is the current staff-only set (contributors, roles,
contacts, PD doc, Drive folder) the complete list of internal detail you need per
historical project, or is anything missing?*
