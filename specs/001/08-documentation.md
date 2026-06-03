# Phase 8 — Documentation & static integration test

**Status:** `TODO`
**Depends on:** Phases 1–7
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 8. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

Hand the cold-start `worker` exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals.
- **Prior phases landed:** the full tool is implemented — CLI (Phase 6), server + routes (Phase 5), parsing/anchoring (Phase 2), storage (Phase 3), generator (Phase 4), and the crafted UI (Phase 7). This phase finalizes docs and runs the **static integration test** (a code-reading cross-check of `app.js` ↔ server routes). It writes **no** product code beyond doc/test fixes.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun run typecheck` clean and `bun test` green; the static integration checklist fully resolved (every row ✓); committed with this file's `Status:` and the root dashboard row both `DONE`. **This is the last phase — STOP after committing and wait for operator approval before merging. Open a PR titled "markdown-reviewer (spec 001)".**

---

## Files touched

- `README.md` — **author/overwrite** so it documents the shipped tool. A pre-spec draft `README.md` may exist at the repo root; treat it as a stale draft to **overwrite**, not a source to preserve — this spec, not that draft, is authoritative.
- `CLAUDE.md` — create/update with how to build, run, test, and the key invariants (composite anchor, source fidelity, comment sanitization)
- `specs/001/refs/static-integration-test.md` — optional: the filled-in checklist table, if it's long enough to be worth extracting (otherwise keep it inline in this file)

## Pre-flight check

```sh
rg -n "/api/(markdown|annotations|done)" src/frontend/app.js
rg -n "/api/(markdown|annotations|done)|\.route|fetch|switch" src/server/index.ts
ls CLAUDE.md README.md 2>/dev/null
bun run typecheck && bun test
```

## Documentation work items

- [ ] **`CLAUDE.md`** — concise build/run/test guide for future agents:
  - Toolchain: Bun only (runtime, server, package manager, test runner); ESM-only remark v11 stack; `tsconfig` notes (`module: esnext`, `moduleResolution: bundler`, `verbatimModuleSyntax`). **No Vite, no `remark-stringify`.**
  - Commands: `bun install`, `bun run typecheck`, `bun test`, `bun run start <file>`, `bun run dev <file>`.
  - The load-bearing invariants, stated so they're not accidentally broken: (1) composite anchor `blockType:textHash:siblingOrdinal`, own-inline-text hash, immediate-parent ordinal, line numbers advisory; (2) **source fidelity** — splice into source, never re-serialize; (3) comment sanitization (`-->`/`--`), markers after closing code fences; (4) frontmatter/thematic-break/raw-HTML skipped; list items anchor on `listItem`.
  - Project structure map (the actual `src/` tree as built).
- [ ] **`README.md`** — author/overwrite it to match the shipped tool, sourced from the **code as built and this spec** (never a pre-spec draft): the `mdr` command + its options, the server API table, the `_reviewed.md` output example, install/dev instructions, the project structure, and the deferred items (root spec's Non-goals) framed as "future improvements." Overwrite any stale draft wholesale.

## Static integration test (mandatory — code-reading, do NOT launch the app)

This repo has **no** `scripts/check-api-routes.py` (that's a different project's tool) and there is no separate `api.ts` — the frontend calls live in `src/frontend/app.js` and the routes live in `src/server/index.ts`. So this is a **manual code-reading checklist**: read both files and confirm every frontend call resolves to a real server route with matching method, path, and request/response field casing. Fill the table; any row that can't be matched is a **bug to fix now**, not a deferral.

For **every** `fetch(...)` call in `app.js`, verify against `src/server/index.ts`:

1. **Route + method exist** — exact path (including `:id` params) and HTTP method appear in the server's route handling.
2. **Request shape matches** — every field the frontend sends in the body maps to a field the handler reads, **same casing** (`siblingOrdinal`, `blockType`, `textHash`, `blockLineRange`, `comment`, `id`). There is no camel/snake translation layer — names must be identical on both sides.
3. **Response shape matches** — every field the frontend reads off the response exists on what the handler returns (`{ source, blocks }`, `{ annotations }`, `{ annotation }`, `{ ok, path }` / `{ ok, error }`), same casing. Flag any field the UI reads that the server never sends.
4. **Error/empty paths** — the statuses the UI branches on are what the handler returns: `DELETE` 404 on missing id; `POST /api/done` returns `{ ok:false, error }` with a non-2xx **and the server stays up** (the UI must handle the error body, and must handle the connection dropping after a **successful** Done because the server shuts down).

Fill this table (one row per frontend call), replacing the examples:

| `app.js` call | Method + path | Server handler | Req fields ✓ | Resp fields ✓ |
| --- | --- | --- | --- | --- |
| load document | `GET /api/markdown` | `GET /api/markdown` | — | `source`, `blocks[].id/anchor/type/text/lineRange/html` ✓ |
| load annotations | `GET /api/annotations` | `GET /api/annotations` | — | `annotations[].{id,anchor,blockType,blockText,blockLineRange,comment,status,createdAt,updatedAt}` ✓ |
| create/update | `POST /api/annotations` | `POST /api/annotations` | `anchor,blockType,blockText,blockLineRange,comment,id?` ✓ | `annotation` ✓ |
| delete | `DELETE /api/annotations/:id` | `DELETE /api/annotations/:id` | — | `ok` ✓ / 404 |
| finish | `POST /api/done` | `POST /api/done` | — | `ok,path` / `ok,error` ✓ |

- [ ] Every frontend `fetch` in `app.js` has a row above with all three ✓ columns satisfied.
- [ ] No row has a casing mismatch (TS/JS key ≠ server JSON key).
- [ ] No row reads a response field the server never sends.
- [ ] The two failure/transition paths (DELETE 404, Done success-then-shutdown vs. Done failure-stays-up) are handled in `app.js`.

## Acceptance criteria

- [ ] (a) `bun run typecheck` clean and `bun test` green across the whole repo.
- [ ] (b) `CLAUDE.md` exists and documents toolchain, commands, and the four load-bearing invariants.
- [ ] (c) `README.md` matches the shipped routes/flags/structure (no stale divergence).
- [ ] (d) The static integration checklist table is fully filled with every row ✓; any mismatch found was fixed (not deferred).
- [ ] (e) `rg "remark-stringify|vite" package.json src` returns nothing (non-goals stayed out).

## When done

1. Verify the acceptance list is fully ticked and the static integration table is all ✓.
2. `bun run typecheck && bun test`.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 8 row to `DONE`.
4. Commit on the branch.
5. **STOP. This is the final phase.** Open a PR titled `markdown-reviewer (spec 001)` and **wait for operator approval before merging to `main`** — do not merge autonomously.
