# 001 — markdown-reviewer: browser-based markdown annotation tool

**Status:** `READY`

## Coding agent: start here

This spec is your complete brief. Each per-phase file under [`001/`](001/) is **self-contained** for completing its phase; you do not need to read this root file in detail or the other phase files. Every product decision is already inlined into the phase files.

> ⚠ **Do NOT read the repo-root `README.md`.** It is a pre-spec draft. This spec supersedes it and may intentionally diverge from it (e.g. the re-location algorithm is deliberately stronger than the draft's). Loading it will confuse you. The draft gets overwritten in Phase 8 as a normal deliverable. The only repo-root docs any phase reads are `DESIGN.md` and `PRODUCT.md`, and only the UI phase (Phase 7) needs them.

**How to use this spec:**

1. Read **Overview**, **Motivation**, **Goals**, **Non-goals** once to anchor on what is being built and what is intentionally excluded.
2. Open the **Phase dashboard** below. The first row whose `Status` is not `DONE` is your active phase. Open that `001/0N-*.md` file and work entirely from it.
3. As you finish work items, tick the checkboxes in the per-phase file. When a phase is complete, set its `Status` to `DONE` in both that file's top-of-file line AND the dashboard row in this file — same commit as the code change.
4. If you lose context mid-feature (a compaction wiped your short-term memory), use the **How to resume after a context compaction** routine in the Implementation phases section.

**Reading discipline — read lazily, one phase at a time. Do NOT front-load.**

- Read **only this root's** Overview / Motivation / Goals / Non-goals, then open **only the one active phase file**. Do **not** read the other phase files, and do **not** re-read this root for design — each phase file is self-contained by construction.
- Read **source files on demand**, when a work item actually requires touching them — start from the phase's **Pre-flight check** commands (they use `rg`/`ls` to surface the few relevant lines), not by opening whole files up front.
- Finish and commit a phase before opening the next one.

> ⚠ **One phase breaks the worker-subagent rule.** Phase 7 (Frontend UI) MUST be implemented in your **main context, not a subagent** — it invokes the interactive `impeccable` skill, which asks the operator clarifying questions before generating visuals. A subagent cannot relay those questions. That phase file restates this at the top in bold. Every *other* phase runs in a worker subagent as usual.

Implementation work happens on the branch `spec/001-markdown-reviewer`. Do not merge the branch to `main` autonomously — that requires explicit operator approval.

---

## Overview

`markdown-reviewer` (CLI: `mdr`) is a single-purpose developer tool that opens a markdown file in the browser, lets the user click any block (heading, paragraph, list item, table cell, code block, blockquote, …) to attach a comment, and on **Done** emits a `<basename>_reviewed.md` file alongside the original. That file contains a summary of every annotation plus the full original source with inline `<!-- Review: [N] … -->` comments spliced in — a structured artifact an LLM agent can read and act on ("read the review of this markdown and apply the necessary changes").

The whole tool is built on **Bun** (runtime, HTTP server, package manager, test runner) and the **unified/remark v11** markdown stack, with **no frontend build step** — the server renders annotatable blocks to HTML server-side and ships a single page plus inline vanilla JS.

## Motivation

Reviewing a markdown doc and handing structured feedback to an LLM agent today means either editing the file inline (loses the "this is a comment, not content" distinction) or writing feedback in a separate channel (loses anchoring to specific blocks). `mdr` closes that gap: comments are anchored to specific blocks, survive reparses and *some* source editing, persist across crashes, and are emitted in a format that is unambiguous to both a human and an agent — without ever re-serializing and reflowing the user's original markdown.

## Goals

- `mdr path/to/doc.md` spins up a local Bun server, opens the browser to a rendered view, and lets the user annotate blocks click-by-click.
- Annotations are anchored by a **composite key** (`blockType : normalizedTextHash : siblingOrdinal`) that survives reparses and unrelated edits; line numbers are advisory only.
- Sessions persist as per-annotation JSON files in a temp dir and **auto-resume** on re-run: re-location matches on content first, so an unedited block that merely shifted position stays attached; a block edited in place is marked `stale`; a block that vanished becomes `orphaned` and is surfaced (never silently dropped). See Phase 2 for the four-tier matcher.
- A single `mdr` process owns a session at a time (lock file); a second invocation refuses to start.
- **Done** generates `<basename>_reviewed.md` by **splicing into the original source string** (never `remark-stringify`), confirms success to the browser, and only then shuts the server down. On failure the UI stays up and reports the error.
- Comment encoding never corrupts the document (sanitized `-->`/`--`, markers after closing code fences, frontmatter/thematic-break/raw-HTML blocks skipped).
- The UI honors the `DESIGN.md` design system ("The Annotated Terminal": dark surface, SUSE Mono headings, SUSE sans chrome, restrained violet/amethyst accents).

## Non-goals

These are explicitly deferred and **out of scope** for spec 001 (they belong in a future "improvements" spec):

- Annotation **types** (suggestion vs. question vs. note).
- Live **file watching** during a session (beyond resume-time stale detection).
- **Multi-file** reviews in one session.
- **Diff/preview** of the reviewed output before export.
- **Drag-to-reattach** UI for orphaned annotations (orphans are surfaced and can be discarded/edited, but not drag-reanchored).
- **Collaboration** / shared sessions.
- A frontend framework or a Vite/dist bundling pipeline. (If bundling is ever needed, use `Bun.build` — never Vite.)
- Light mode / a formal WCAG target (best-effort a11y only).
- **Performance work for very large documents** — no DOM virtualization, pagination, or render budget for huge files (e.g. thousands of blocks). v1 renders the whole document at once; a doc with hundreds of blocks should be fine. If a real document is large enough to feel slow, that's a follow-up spec, not a blocker here.

## Implementation phases

This spec is split into per-phase work files under [`001/`](001/) so each phase fits comfortably in a context window alongside the relevant source code. Each phase file is self-contained — it carries the data model, API contract, and UI specification details relevant to its work. The **Phase dashboard** below is the single source of truth for "what's done."

### Phase dashboard

| # | Phase | File | Subagent? | Status |
|---|-------|------|-----------|--------|
| 1 | Project scaffold & shared types | [`001/01-scaffold-and-types.md`](001/01-scaffold-and-types.md) | worker | `DONE` |
| 2 | Markdown parsing, block render & anchoring | [`001/02-parsing-and-anchoring.md`](001/02-parsing-and-anchoring.md) | worker | `DONE` |
| 3 | Annotation storage service (JSON + session lock) | [`001/03-annotation-storage.md`](001/03-annotation-storage.md) | worker | `DONE` |
| 4 | Review generator (`_reviewed.md`) | [`001/04-review-generator.md`](001/04-review-generator.md) | worker | `DONE` |
| 5 | HTTP server & API routes | [`001/05-http-server-and-api.md`](001/05-http-server-and-api.md) | worker | `DONE` |
| 6 | CLI entry (args, port, launch, open) | [`001/06-cli-entry.md`](001/06-cli-entry.md) | worker | `TODO` |
| 7 | **Frontend UI (impeccable — MAIN CONTEXT, no subagent)** | [`001/07-frontend-ui.md`](001/07-frontend-ui.md) | **NO — main context** | `TODO` |
| 8 | Documentation & static integration test | [`001/08-documentation.md`](001/08-documentation.md) | worker | `TODO` |

Statuses: `TODO` → `IN PROGRESS` → `DONE`. Update both this table AND the top of the corresponding phase file in the same commit — they must always agree.

### How to resume after a context compaction

If you are reading this AFTER a compaction (you don't remember what you were doing), follow this routine exactly:

1. **Confirm which spec** — run `git branch --show-current`. It should be `spec/001-markdown-reviewer`.
2. **Find the current phase** — the first dashboard row above whose status is NOT `DONE` is where to resume. The dashboard is authoritative; the top ~5 lines of any `001/0N-*.md` file restate the same `Status:` value and must agree.
3. **Open the current phase file and work entirely from it.** Every per-phase file has: a `Status:` line in the top ~5 lines (`head -5` shows it); **Files touched**; a **Pre-flight check** block with concrete `rg`/`bun` commands to run on every resume; the **Data model / API contract / UI** sections it needs inline; **Work items** checkboxes; **Acceptance criteria** checkboxes.
4. **Make progress, then update state, then commit.** Commit the phase file alongside the code so the next resume sees ticked boxes matching on-disk reality. Flip `TODO`→`IN PROGRESS` in both the dashboard row and the phase file's `Status:` line in the same commit when you start.
5. **When the phase is fully done**, set both the dashboard row AND the phase file's `Status:` to `DONE`, then open the next phase file.
6. **Never skip a phase.** Dependencies are in each file's `Depends on:` line.

The contract between you-now and you-after-compaction is: **dashboard row + phase file `Status:` line + phase file work-item checkboxes** are the only state you can trust.

### Gates (this is a Bun/TypeScript repo — there is no `cargo`)

Run these before marking any phase `DONE` (a phase that adds tests also runs them):

```sh
bun install            # once, and after any dependency change
bun run typecheck      # tsc --noEmit; MUST be clean
bun test               # phases 2/3/4 add unit tests — keep them green
```

The frontend↔server wiring is verified by the **static integration test** in Phase 8 (a code-reading checklist mapping every `app.js` fetch call to a real server route + method + shape). There is no `cargo clippy`/`npm run lint` in this repo; do not invent one.

## Open questions

_None._ All product decisions are resolved in this spec and its phase files. If an ambiguity surfaces during implementation, stop and raise it with the operator rather than guessing — do not silently re-serialize the AST, drop an orphan, or change the composite-anchor scheme.
