# 002 — Multi-file review: link-driven navigation across related markdown files

**Status:** `READY`

## Coding agent: start here

This spec is your complete brief — you do not need to read `specs/readme.md` (that file is for the spec author, not you). Each per-phase file under [`002/`](002/) is **self-contained** for completing its phase; you do not need to read this root file in detail or the other phase files.

**How to use this spec:**

1. Read **Overview**, **Motivation**, **Goals**, **Non-goals** once to anchor on what is being built and what is intentionally excluded.
2. Open the **Phase dashboard** below. The first row whose `Status` is not `DONE` is your active phase. Open that `002/0N-*.md` file and work entirely from it.
3. As you finish work items, tick the checkboxes in the per-phase file. When a phase is complete, set its `Status` to `DONE` in both that file's top-of-file line AND the dashboard row in this file — same commit as the code change.
4. If you lose context mid-feature (a compaction wiped your short-term memory), use the **How to resume after a context compaction** routine in the Implementation phases section.

**Reading discipline — read lazily, one phase at a time. Do NOT front-load.**

- Read **only this root's** Overview / Motivation / Goals / Non-goals, then open **only the one active phase file**. Do **not** read the other phase files, and do **not** re-read this root for design — each phase file is self-contained by construction.
- Read **source files on demand**, when a work item actually requires touching them — start from the phase's **Pre-flight check** commands (they use `rg`/`ls` to surface the few relevant lines), not by opening whole files up front. Prefer targeted searches over full-file reads.
- Read referenced docs (e.g. `DESIGN.md`) **only when the phase you are on tells you to**. Don't open a doc a later phase needs while working an earlier phase.
- Finish and commit a phase before opening the next one. Opening everything at once burns the context window before any code is written and gives no benefit — phases are sequential and self-contained on purpose.

Implementation work happens on the branch `specs/002-multi-file-review` (already checked out — commit here, never merge to `main` without explicit operator approval).

## Overview

Extend `mdr` so a user can navigate from one markdown file to another via relative links during a single annotation session. Clicking a relative `.md` link in the rendered document loads the linked file, adds it to the session's file list, and switches the view. Annotations are scoped per-file. On Done, all annotated files are listed in a consolidated prompt that points the consuming agent at the generated `.mdr` review files.

## Motivation

Specs, RFCs, and documentation often reference related files — other specs, architecture docs, API references. Today `mdr` opens one file. To annotate a spec that links to its companion docs, the user must run `mdr` multiple times, losing context between sessions. This feature lets the user follow links naturally, annotating across a file graph in one sitting.

## Goals

- Start with a single entry file: `mdr <file.md>`
- Relative `.md` links in rendered markdown are clickable and load the target file
- Each navigated file appears in a sidebar "Files" zone for switching, presented as a depth-first tree (entry file first, then path-sorted), crafted to the project's design system
- Annotations are scoped per-file (same existing mechanism)
- Done shows the generated review-file paths in a modal — review files are already current
- The reviewed-file output uses the **`.mdr`** suffix (`spec.md` → `spec.mdr`), generated on every annotation save/delete — always up to date
- Each `.mdr` file carries the existing **AGENT PROTOCOL block** (from `src/review/generator.ts`) verbatim at the top; the copy-prompt is a thin pointer to those files, not a re-statement of the apply instructions. The block instructs the agent to **delete a file's `.mdr` once its review has been applied** to the source (consumed artifact)
- Server shuts down via heartbeat when the browser closes (15s after the first successful ping stops)
- Session context persists across launches via an explicit session manifest: relaunching `mdr` on any previously-loaded file restores the full session — **including files with no annotations / no `.mdr`** (the doc cluster stays mapped)
- An optional `--auto-discover` flag maps the whole relative-`.md` link graph reachable from the entry file into the session in a background crawl (cycle-safe), so editing one file later surfaces every related file an agent should check for repercussions without delaying the first page load

## Non-goals

- Opening multiple files at startup (`mdr file1.md file2.md`)
- Absolute path links or external URLs
- Tab-based UI — sidebar file zone only
- Generating a single combined `.mdr` — per-file output only
- Link preview or breadcrumb trail
- Rewriting the AGENT PROTOCOL block's triage policy — its APPLY/ASK semantics are owned by spec 001 / PR #4 and are reused as-is; this spec only adjusts the **suffix wording** inside it (`_reviewed` → `.mdr`)

## Success signals

1. `mdr spec.md` opens. User clicks a relative link `→ other.md` loads in the same view.
2. Sidebar shows a "Files" zone listing both files. Clicking switches the view.
3. Annotations on `spec.md` do not appear on `other.md` and vice versa.
4. Done shows `spec.mdr` + `other.mdr` paths in a prompt-ready modal.
5. `.mdr` files are current after every annotation — no generation delay.
6. Closing the browser shuts down the server (heartbeat timeout).
7. Relaunching `mdr` on `spec.md` restores all previously-navigated files in the sidebar.
8. Each `spec.mdr` opens with the AGENT PROTOCOL block as its first bytes; the copy-prompt simply lists the `.mdr` paths and defers to that block.
9. Launching a fresh file `D` and then clicking a link to a file already in an existing session merges `D` into that session (not a new overlapping one); afterwards opening any member shows the full merged file list.
10. With session `{A,B,C}` already on disk, launching a fresh run `{D,E,F}` and clicking a link to `A` merges all six files under the older (`{A,B,C}`) session id and deletes the younger run's manifest.
11. `mdr spec.md --auto-discover` serves the initial page promptly, then the Files zone fills with every relative-`.md` file reachable from `spec.md` as the background crawl completes (cycle-safe), without the user clicking through them.
12. After an agent applies a file's review, it deletes that file's `.mdr`; the source edits and the report remain.
13. The Files zone lists `readme.md, docs/api.md, docs/api/read.md, docs/workflow.md` in that depth-first order regardless of the order they were visited, with per-file annotation counts and the active file highlighted.

## Load-bearing invariants

- **Annotations are per-file.** The existing `sessionDir(filePath)` mechanism already scopes annotations by file path. Multi-file adds a "session concept" but annotations remain file-local.
- **Session paths are absolute.** The `.path` marker in annotation dirs always stores the absolute file path. Same basenames (`readme.md`, `AGENTS.md`) in different projects are disambiguated by their full paths.
- **Links are relative only.** Only `.md` links with relative paths (no scheme, no leading `/`) are navigational. All other links render as normal `<a>` tags.
- **Reviewed files are `.mdr`, not `.md`.** Output is `source.replace(/\.md$/i, ".mdr")`. Because `.mdr` is not a `.md` file, generated review files are **never** navigational links (Phase 2 only marks `.md`) and are **never** discovered as session source files — the `.r.md`/`spec.r.r.md` collision class does not exist by construction.
- **The AGENT PROTOCOL block is authoritative for applying a review.** It is embedded verbatim at the top of every `.mdr` by `generateReview()` in `src/review/generator.ts`. The copy-prompt and any UI text must defer to it, never duplicate or contradict its APPLY/ASK triage. The block's "SOURCE FILE" and "BATCH" wording must name the `.mdr` suffix, not `_reviewed`.
- **Resolved paths must exist.** The server validates that a relative link resolves to an existing file before exposing it as navigational. Broken links render as normal (non-clickable for navigation).
- **Entry directory is the session root.** File keys are stored relative to the entry file's parent directory. This is only the key namespace; it is not the link-resolution base for every file.
- **Links resolve like Markdown links.** A relative `.md` link is resolved against the directory of the file that contains the link. The resolved absolute path is then converted to a `FileKey` relative to the session root.
- **Every loaded file has a session handle.** The server keeps one open annotation session per loaded file and releases all locks on shutdown.
- **Session membership is explicit.** A session manifest records loaded files, including files with zero annotations. Discovery must not scan the entire tmpDir and treat unrelated annotation dirs as one session.
- **Sessions merge, never split or overlap.** When navigation (via link) connects two different sessions, they merge into one: the **older session survives** (smallest `createdAt`) and the **younger session's manifest is deleted**; the union of both file lists lives under the surviving id. A file therefore belongs to exactly one session at a time — you can never end up with two overlapping sessions that each claim the same file. The common case (launching a fresh file, then linking into an established session) follows directly: the fresh run is younger, so it is absorbed. This rule is **order-independent** — clicking A from the {D,E,F} run, or clicking D from the {A,B,C} run, both leave one session whose id is the older of the two. (Detailed algorithm in Phase 5.)
- **Server shuts down via heartbeat.** Frontend pings every 5s after page init. If at least one ping has been received and then no ping arrives for 15s, browser is gone → server exits. Done is a UI step only — reviewed files are already current.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Circular file references (A links to B, B links to A) | Track "already loaded" files. Re-clicking a loaded file just switches view, doesn't reload. |
| Deeply nested relative paths (`../../foo.md`) | Resolve with `path.resolve()`/`realpath()` against the current file's directory, require an existing regular `.md` file, and allow traversal only because this is an explicit local-file tool. |
| Large files loaded on-demand | Same timeout/validation as single-file. If a file fails to parse, show error in status bar and don't add to file list. |
| Annotation count confusion (total vs per-file) | Toolbar shows per-file count. Sidebar file zone shows count per file. |
| AGENT PROTOCOL block drifts from the chosen suffix | Phase 1 updates the block's "SOURCE FILE"/"BATCH" wording to `.mdr` and a generator test asserts a `.mdr`-derived source path; Phase 4 forbids re-stating apply instructions in the prompt. |

## Implementation phases

This spec is split into per-phase work files under [`002/`](002/) so each phase fits comfortably in a context window alongside the relevant source code. Each phase file is self-contained — it carries the data model, API contract, and UI specification details relevant to its work. The **Phase dashboard** below is the single source of truth for "what's done."

### Phase dashboard

| # | Phase | File | Status |
|---|-------|------|--------|
| 1 | Server: per-file state, on-demand loading, file key scoping, `.mdr` generation | [`./002/01-server-multi-file.md`](./002/01-server-multi-file.md) | `DONE` |
| 2 | Markdown service: relative link detection | [`./002/02-link-detection.md`](./002/02-link-detection.md) | `DONE` |
| 3 | Frontend: link interception, per-file view & annotation wiring | [`./002/03-frontend-multi-file.md`](./002/03-frontend-multi-file.md) | `DONE` |
| 4 | Review modal and server lifecycle | [`./002/04-done-multi-file.md`](./002/04-done-multi-file.md) | `TODO` |
| 5 | Session persistence: resume multi-file context across launches | [`./002/05-session-persistence.md`](./002/05-session-persistence.md) | `TODO` |
| 6 | `--auto-discover`: eager link-graph crawl into the session | [`./002/06-auto-discover.md`](./002/06-auto-discover.md) | `TODO` |
| 7 | File navigation tree (craft — `/impeccable`, no subagent) | [`./002/07-file-navigation.md`](./002/07-file-navigation.md) | `TODO` |
| 8 | Documentation, static integration test & route test | [`./002/08-docs-and-test.md`](./002/08-docs-and-test.md) | `TODO` |

Statuses: `TODO` → `IN PROGRESS` → `DONE`. Update both this table AND the top of the corresponding phase file in the same commit — they must always agree.

### How to resume after a context compaction

If you are reading this AFTER a compaction (you don't remember what you were doing), follow this routine exactly:

1. **Confirm which spec** — run `git branch --show-current`. It should be `specs/002-multi-file-review`. If not, you may be on the wrong feature.
2. **Find the current phase** — look at the dashboard table above. The first row whose status is NOT `DONE` is where to resume. The dashboard is authoritative for phase-level status. (If you want to double-check, the top ~5 lines of any `002/0N-*.md` file restate the same `Status:` value; the two must agree. If they ever disagree, trust whichever is `IN PROGRESS` and reconcile.)
3. **Open the current phase file and work entirely from it.** Every per-phase file is structured the same way:
   - A `Status:` line at the top (top ~5 lines) so you can tell its state with a single `head -5`.
   - **Files touched** — the concrete paths you will edit.
   - A **Pre-flight check** block with concrete `rg` / `bun test` / `curl` commands. **Run these every time you resume** — they're cheap and remove ambiguity.
   - **Data model / API contract / UI** sections containing every contract your phase needs. **You do not need to re-read the root spec for shared design** — it is all in the phase file.
   - A **Work items** section with checkboxes (`- [ ]` / `- [x]`). The first unticked item is where you pick up.
4. **Make progress, then update state, then commit.** Commit the phase file along with the code changes — that way the next resume sees ticked boxes that match the on-disk reality. If a phase transitions from `TODO` → `IN PROGRESS` because you started it, update both the dashboard row above AND the phase file's `Status:` line in the same commit.
5. **When the phase is fully done**, set both the dashboard row AND the phase file's `Status:` to `DONE`, then open the next phase file. The phase file's "When done" footer reminds you of this.
6. **Never skip a phase.** Dependencies are listed in each file's `Depends on:` line near the top.

The contract between you-now and you-after-compaction is: **dashboard row + phase file `Status:` line + phase file work-item checkboxes** are the only state you can trust. Anything else (your memory, in-context plans) may be gone. Keep all three honest after every commit.

## Open questions

_None._ — all prior open questions were resolved during adversarial review:

- **Path traversal safety:** Allow `../` to traverse up and into sibling directories. Validate the resolved file exists. (Resolved: user confirmed)
- **Maximum files:** No hard cap. Adjust later if rendering breaks with many files. (Resolved: user confirmed)
- **Session cleanup:** Manual only via `mdr --clean`. No auto-cleanup. (Resolved: user confirmed)
- **Session identity:** Use an explicit manifest under the tmpDir, not tmpDir-wide discovery. Each loaded file's annotation dir gets `.path` + `.session`; the manifest stores the complete file list, including zero-annotation files. (Resolved by adversarial review)
- **Reviewed-file suffix:** `.mdr` (e.g. `spec.mdr`). Chosen over `_reviewed.md`/`.r.md` because it is not a `.md` file and therefore cannot be re-loaded as a source or marked as a navigational link. The AGENT PROTOCOL block embedded in each `.mdr` is updated to name this suffix. (Resolved: user confirmed)
- **Merge survivor:** when two sessions are connected by navigation, the **older** (smaller `createdAt`) survives and the younger's manifest is deleted. Order-independent and matches "a fresh run joining an established session is the one absorbed." (Resolved: user confirmed)
- **`.mdr` cleanup:** the AGENT PROTOCOL block instructs the consuming agent to delete a file's `.mdr` once its review has been applied (and it has no open ASK items). Never before the source edit; never the source itself. (Resolved: user confirmed)
- **Auto-discovery model:** `--auto-discover` is opt-in, background, and **register-only** — it crawls the link graph and adds members to the manifest/Files zone without blocking the first page response, but each file's render + lock stays lazy (on first click), so a large cluster doesn't load or lock everything at startup. (Resolved: register-only chosen to match the existing lazy-load model; flag default off.)
