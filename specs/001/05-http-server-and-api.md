# Phase 5 — HTTP server & API routes

**Status:** `TODO`
**Depends on:** Phase 1, Phase 2, Phase 3, Phase 4
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 5. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

Hand the cold-start `worker` exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals.
- **Prior phases landed:** Phase 2 `markdown-service` (`loadDocument(path)` → `{ source, fileHash, blocks }`, `parseDocument`); Phase 2 `anchoring` (`relocate(annotations, blocks)`); Phase 3 `annotation-service` (`openSession(basename, fileHash, { tmpDir, fresh })` → `Session` with `list/save/remove/release`); Phase 4 `generator` (`writeReview(...)` / `generateReview(...)`). Wire these together — do not reimplement them.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun run typecheck` clean; every route verified by `curl` (commands below) against a manually started server; committed with this file's `Status:` and the root dashboard row both `DONE`.

> This phase ships a **bare, unstyled** `page.html` + `app.js` good enough to prove the API end-to-end via curl/browser. The polished, design-system-faithful UI is **Phase 7** (which owns and rewrites these two files using the `impeccable` skill). Do not invest in visual design here — keep the page minimal and functional. Do not over-build `app.js`; a thin fetch harness is enough.

---

## Files touched

- `src/server/index.ts` — `startServer(opts)`: `Bun.serve`, route table, page rendering, static serving, lifecycle/shutdown
- `src/frontend/page.html` — minimal page template (server injects rendered blocks); **placeholder styling only**
- `src/frontend/app.js` — minimal vanilla-JS fetch harness; **placeholder only — rebuilt in Phase 7**
- `public/` — referenced for static assets (may be empty/`.gitkeep` for now)
- `src/server/index.test.ts` — optional route smoke tests (Bun can `fetch` its own server)

## Pre-flight check

```sh
rg -n "Bun.serve|startServer|/api/(markdown|annotations|done)" src/server/index.ts 2>/dev/null
# Manual smoke (after wiring): start a server against a sample file, then:
# curl -s localhost:PORT/api/markdown | head
# curl -s localhost:PORT/api/annotations
```

## Server contract

```typescript
export interface ServerOptions {
  filePath: string;       // the markdown file being reviewed (absolute or cwd-relative)
  port?: number;          // if omitted, auto-select a FREE port (port 0 → OS assigns) and report it
  tmpDir: string;         // annotation storage root (default decided by CLI; service takes it as param)
  fresh?: boolean;        // pass through to openSession
}

export interface RunningServer { url: string; port: number; stop(): Promise<void>; }

// Acquires the session lock (throws the typed "locked" error from Phase 3 if held live),
// loads + parses the document, starts Bun.serve, returns the running server.
export function startServer(opts: ServerOptions): Promise<RunningServer>;
```

- **Port:** when `port` is omitted, bind to an OS-assigned free port (`Bun.serve({ port: 0 })`) and read the actual port back from the server object. `--port` (Phase 6) overrides.
- **Session lifecycle:** call `openSession` at startup (surfacing the locked error so the CLI can refuse to start); call `session.release()` on shutdown.

## API contract (authoritative — Phase 7's `app.js` and Phase 8's static integration test check against this)

| Method | Endpoint | Request body | Success response | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/` | — | `text/html` | Prerendered page: `page.html` with server-rendered block HTML injected, inline `app.js` (or `<script src>` to it). |
| `GET` | `/api/markdown` | — | `{ "source": string, "blocks": BlockNode[] }` | `source` = raw markdown; `blocks` = parsed clickable blocks (each with `id`, `anchor`, `type`, `text`, `lineRange`, `html`). |
| `GET` | `/api/annotations` | — | `{ "annotations": Annotation[] }` | All annotations after `relocate` against current blocks (statuses `ok`/`stale`/`orphaned`). |
| `POST` | `/api/annotations` | `{ anchor: BlockAnchor, blockType, blockText, blockLineRange, comment, id? }` | `{ "annotation": Annotation }` (201/200) | Create (no `id`) or update (with `id`). Server stamps `createdAt`/`updatedAt` and re-locates `status`. |
| `DELETE` | `/api/annotations/:id` | — | `{ "ok": true }` (200) or `404` | Remove one annotation by id. |
| `POST` | `/api/done` | — (empty) | `{ "ok": true, "path": string }` (200), then **server shuts down**; or `{ "ok": false, "error": string }` (5xx, **server stays up**) | Generate `_reviewed.md` via the Phase 4 generator. |

- **Field casing is wire-exact:** all JSON keys are exactly the `Annotation`/`BlockAnchor`/`BlockNode` field names from `src/shared/types.ts` (`siblingOrdinal`, `blockType`, `textHash`, `blockLineRange`, `lineRange`, `createdAt`, `updatedAt`). The frontend (Phase 7) is TypeScript-flavored vanilla JS but reads/writes these exact keys — no `camelCase`↔`snake_case` translation layer exists; keep names identical on both sides.
- **`POST /api/done` ordering is load-bearing:** generate + **write the file first**; only on a **successful write** return success AND then stop the server (let the HTTP response flush before `stop()`). On generation/write **failure**, return an error status with the message and **keep the server running** so the UI can report it and the user can retry. Never shut down on the failure path.
- Errors are JSON (`{ ok: false, error }`) with an appropriate status; the UI branches on the JSON `error`, not on parsing an HTML error page.

## Page rendering

`GET /` returns `page.html` with the server-rendered annotatable blocks injected at a known placeholder (e.g. a `<!--BLOCKS-->` marker or a `<main id="doc">` the server fills). The blocks already carry `data-block-id` (and `data-anchor`) from Phase 2. Serve `app.js` either inline in the page or from a static route (`GET /app.js`). Keep it a single page — no router, no framework, no bundler.

## Work items

### 1. Server + lifecycle
- [ ] `startServer(opts)` — `openSession` (surface locked error), `loadDocument`, `Bun.serve` (free port when unset), return `{ url, port, stop }`. `stop()` releases the session and closes the server.
### 2. Routes
- [ ] `GET /` — inject rendered blocks into `page.html`, serve with `app.js`.
- [ ] `GET /api/markdown` — `{ source, blocks }`.
- [ ] `GET /api/annotations` — load via session, `relocate` against current blocks, return `{ annotations }`.
- [ ] `POST /api/annotations` — validate body, create/update via `session.save`, re-locate, return `{ annotation }`.
- [ ] `DELETE /api/annotations/:id` — `session.remove`, return `{ ok: true }` or `404`.
- [ ] `POST /api/done` — generate+write via Phase 4; success → `{ ok, path }` then `stop()` after flush; failure → error status, **stay up**.
### 3. Minimal placeholder frontend (rebuilt in Phase 7)
- [ ] `src/frontend/page.html` — minimal template with the blocks placeholder + a Done control. No design work.
- [ ] `src/frontend/app.js` — thin harness: load `/api/markdown` + `/api/annotations`, click a block → prompt/textarea → `POST`, Done → `POST /api/done`. Enough to prove wiring; not the final UX.
### 4. Verify
- [ ] Start a server against a sample doc; `curl` each route (GET markdown/annotations, POST then DELETE an annotation, POST done) and confirm shapes + the done-then-shutdown behavior.

## Acceptance criteria

- [ ] (a) `bun run typecheck` clean.
- [ ] (b) `GET /api/markdown` returns `{ source, blocks }` with `blocks[].id` + `blocks[].anchor.siblingOrdinal` present.
- [ ] (c) `POST /api/annotations` persists a file (visible in the session dir) and the follow-up `GET /api/annotations` returns it with a `status`.
- [ ] (d) `POST /api/done` writes `<basename>_reviewed.md` next to the source and the server then exits; a forced generator failure returns an error and the server stays up.
- [ ] (e) Starting a second server on the same file while the first holds the lock fails with the typed "locked" error.

## When done

1. Verify acceptance list ticked.
2. `bun run typecheck` (+ any smoke tests).
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 5 row to `DONE`.
4. Commit. Move to [`06-cli-entry.md`](06-cli-entry.md).
