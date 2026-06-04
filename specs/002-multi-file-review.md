# 002 — Multi-file review: link-driven navigation across related markdown files

**Status:** `DRAFT`

## Coding agent: start here

This spec is your complete brief. Each per-phase file under [`002/`](./002/) is a self-contained unit — read the phase file, implement it, verify it, move to the next. Do not skip phases. Do not merge phases. If a phase's acceptance criteria are not met, do not proceed.

## Overview

Extend `mdr` so a user can navigate from one markdown file to another via relative links during a single annotation session. Clicking a relative `.md` link in the rendered document loads the linked file, adds it to the session's file list, and switches the view. Annotations are scoped per-file. On Done, all annotated files are summarized in a consolidated prompt.

## Motivation

Specs, RFCs, and documentation often reference related files — other specs, architecture docs, API references. Today `mdr` opens one file. To annotate a spec that links to its companion docs, the user must run `mdr` multiple times, losing context between sessions. This feature lets the user follow links naturally, annotating across a file graph in one sitting.

## Goals

- Start with a single entry file: `mdr <file.md>`
- Relative `.md` links in rendered markdown are clickable and load the target file
- Each navigated file appears in a sidebar zone for switching
- Annotations are scoped per-file (same existing mechanism)
- Done generates per-file `_reviewed.md` files and lists them in the prompt for the agent to read
- Server stays alive after Done (user can continue editing or quit manually)
- Session context persists across launches: relaunching `mdr` on any previously-annotated file restores the full session

## Non-goals

- Opening multiple files at startup (`mdr file1.md file2.md`)
- Absolute path links or external URLs
- Tab-based UI — sidebar file zone only
- Generating a single combined `_reviewed.md` — per-file output only
- Link preview or breadcrumb trail

## Success signals

1. `mdr spec.md` opens. User clicks a relative link `→ other.md` loads in the same view.
2. Sidebar shows a "Files" zone listing both files. Clicking switches the view.
3. Annotations on `spec.md` do not appear on `other.md` and vice versa.
4. Done generates `spec_reviewed.md` + `other_reviewed.md` and shows a prompt listing both reviewed file paths.
5. Server remains running after Done. Ctrl-C to quit.
6. Relaunching `mdr` on `spec.md` restores all previously-navigated files in the sidebar.

## Phase dashboard

| # | Phase | File | Status |
|---|-------|------|--------|
| 1 | Server: per-file state, on-demand loading, file key scoping | [`./002/01-server-multi-file.md`](./002/01-server-multi-file.md) | `TODO` |
| 2 | Markdown service: relative link detection | [`./002/02-link-detection.md`](./002/02-link-detection.md) | `TODO` |
| 3 | Frontend: sidebar file zone, link interception, per-file view | [`./002/03-frontend-multi-file.md`](./002/03-frontend-multi-file.md) | `TODO` |
| 4 | Done: multi-file file list, prompt with reviewed paths, no shutdown | [`./002/04-done-multi-file.md`](./002/04-done-multi-file.md) | `TODO` |
| 5 | Session persistence: resume multi-file context across launches | [`./002/05-session-persistence.md`](./002/05-session-persistence.md) | `TODO` |
| 6 | Documentation & static integration test | [`./002/06-docs-and-test.md`](./002/06-docs-and-test.md) | `TODO` |

## Load-bearing invariants

- **Annotations are per-file.** The existing `sessionDir(filePath)` mechanism already scopes annotations by file path. Multi-file adds a "session concept" but annotations remain file-local.
- **Session paths are absolute.** The `.path` marker in annotation dirs always stores the absolute file path. Same basenames (`readme.md`, `AGENTS.md`) in different projects are disambiguated by their full paths.
- **Links are relative only.** Only `.md` links with relative paths (no scheme, no leading `/`) are navigational. All other links render as normal `<a>` tags.
- **Resolved paths must exist.** The server validates that a relative link resolves to an existing file before exposing it as navigational. Broken links render as normal (non-clickable for navigation).
- **Entry file is the root.** The entry file determines the base directory for resolving relative links. All navigation is relative to the entry file's directory.
- **Server stays alive after Done.** The Done flow generates output but does not shut down the server. The user quits with Ctrl-C.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Circular file references (A links to B, B links to A) | Track "already loaded" files. Re-clicking a loaded file just switches view, doesn't reload. |
| Deeply nested relative paths (`../../foo.md`) | Resolve with `path.resolve()` + validate the result exists. Reject paths outside the entry file's parent tree if desired. |
| Large files loaded on-demand | Same timeout/validation as single-file. If a file fails to parse, show error in status bar and don't add to file list. |
| Annotation count confusion (total vs per-file) | Toolbar shows per-file count. Sidebar file zone shows count per file. |

## Open questions

- **Path traversal safety:** Should we restrict navigation to files within the entry file's directory tree, or allow `../` to escape? Default: allow `../` but validate existence.
- **Maximum files:** Should we cap the number of navigable files? Default: no hard cap, but practical limit is ~8-10 based on sidebar space.
- **Session cleanup:** When does a session expire? Should we auto-clean old annotation dirs? Default: no auto-cleanup — user manages via `mdr --clean` or manual deletion.
