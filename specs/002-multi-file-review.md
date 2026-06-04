1|# 002 — Multi-file review: link-driven navigation across related markdown files
2|
3|**Status:** `DRAFT`
4|
5|## Coding agent: start here
6|
7|This spec is your complete brief. Each per-phase file under [`002/`](./002/) is a self-contained unit — read the phase file, implement it, verify it, move to the next. Do not skip phases. Do not merge phases. If a phase's acceptance criteria are not met, do not proceed.
8|
9|## Overview
10|
11|Extend `mdr` so a user can navigate from one markdown file to another via relative links during a single annotation session. Clicking a relative `.md` link in the rendered document loads the linked file, adds it to the session's file list, and switches the view. Annotations are scoped per-file. On Done, all annotated files are summarized in a consolidated prompt.
12|
13|## Motivation
14|
15|Specs, RFCs, and documentation often reference related files — other specs, architecture docs, API references. Today `mdr` opens one file. To annotate a spec that links to its companion docs, the user must run `mdr` multiple times, losing context between sessions. This feature lets the user follow links naturally, annotating across a file graph in one sitting.
16|
17|## Goals
18|
19|- Start with a single entry file: `mdr <file.md>`
20|- Relative `.md` links in rendered markdown are clickable and load the target file
21|- Each navigated file appears in a sidebar zone for switching
22|- Annotations are scoped per-file (same existing mechanism)
23|- Done shows reviewed file paths in a modal — `.r.md` files are already current
- `.r.md` generated on every annotation save — always up to date
- Server shuts down via heartbeat when browser closes (15s no ping)
24|- Session context persists across launches: relaunching `mdr` on any previously-annotated file restores the full session
25|
26|## Non-goals
27|
28|- Opening multiple files at startup (`mdr file1.md file2.md`)
29|- Absolute path links or external URLs
30|- Tab-based UI — sidebar file zone only
31|- Generating a single combined `.r.md` — per-file output only
32|- Link preview or breadcrumb trail
33|
34|## Success signals
35|
36|1. `mdr spec.md` opens. User clicks a relative link `→ other.md` loads in the same view.
37|2. Sidebar shows a "Files" zone listing both files. Clicking switches the view.
38|3. Annotations on `spec.md` do not appear on `other.md` and vice versa.
4. Done shows `spec.r.md` + `other.r.md` paths in a prompt-ready modal.
5. `.r.md` files are current after every annotation — no generation delay.
6. Closing the browser shuts down the server (heartbeat timeout).
7. Relaunching `mdr` on `spec.md` restores all previously-navigated files in the sidebar.
42|
43|## Phase dashboard
44|
45|| # | Phase | File | Status |
46||---|-------|------|--------|
47|| 1 | Server: per-file state, on-demand loading, file key scoping | [`./002/01-server-multi-file.md`](./002/01-server-multi-file.md) | `TODO` |
48|| 2 | Markdown service: relative link detection | [`./002/02-link-detection.md`](./002/02-link-detection.md) | `TODO` |
49|| 3 | Frontend: sidebar file zone, link interception, per-file view | [`./002/03-frontend-multi-file.md`](./002/03-frontend-multi-file.md) | `TODO` |
50|| 4 | Done: reviewed file modal, prompt, heartbeat shutdown | [`./002/04-done-multi-file.md`](./002/04-done-multi-file.md) | `TODO` |
51|| 5 | Session persistence: resume multi-file context across launches | [`./002/05-session-persistence.md`](./002/05-session-persistence.md) | `TODO` |
52|| 6 | Documentation & static integration test | [`./002/06-docs-and-test.md`](./002/06-docs-and-test.md) | `TODO` |
53|
54|## Load-bearing invariants
55|
56|- **Annotations are per-file.** The existing `sessionDir(filePath)` mechanism already scopes annotations by file path. Multi-file adds a "session concept" but annotations remain file-local.
57|- **Session paths are absolute.** The `.path` marker in annotation dirs always stores the absolute file path. Same basenames (`readme.md`, `AGENTS.md`) in different projects are disambiguated by their full paths.
58|- **Links are relative only.** Only `.md` links with relative paths (no scheme, no leading `/`) are navigational. All other links render as normal `<a>` tags.
59|- **Resolved paths must exist.** The server validates that a relative link resolves to an existing file before exposing it as navigational. Broken links render as normal (non-clickable for navigation).
60|- **Entry file is the root.** The entry file determines the base directory for resolving relative links. All navigation is relative to the entry file's directory.
61|- **Server shuts down via heartbeat.** Frontend pings every 5s. If no ping for 15s, browser is gone → server exits. Done is a UI step only — reviewed files are already current.
62|
63|## Risks and mitigations
64|
65|| Risk | Mitigation |
66||------|-----------|
67|| Circular file references (A links to B, B links to A) | Track "already loaded" files. Re-clicking a loaded file just switches view, doesn't reload. |
68|| Deeply nested relative paths (`../../foo.md`) | Resolve with `path.resolve()` + validate the result exists. Reject paths outside the entry file's parent tree if desired. |
69|| Large files loaded on-demand | Same timeout/validation as single-file. If a file fails to parse, show error in status bar and don't add to file list. |
70|| Annotation count confusion (total vs per-file) | Toolbar shows per-file count. Sidebar file zone shows count per file. |
71|
72|## Open questions
73|
74|- **Path traversal safety:** Should we restrict navigation to files within the entry file's directory tree, or allow `../` to escape? Default: allow `../` but validate existence.
75|- **Maximum files:** Should we cap the number of navigable files? Default: no hard cap, but practical limit is ~8-10 based on sidebar space.
76|- **Session cleanup:** When does a session expire? Should we auto-clean old annotation dirs? Default: no auto-cleanup — user manages via `mdr --clean` or manual deletion.
77|