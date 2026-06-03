# Phase 3 — Annotation storage service (JSON + session lock)

**Status:** `TODO`
**Depends on:** Phase 1, Phase 2
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 3. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

Hand the cold-start `worker` exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals.
- **Prior phases landed:** Phase 1 has `src/shared/types.ts` (`Annotation`, `AnnotationStatus`). Phase 2 has `src/server/markdown-service.ts` (`loadDocument` → `{ source, fileHash, blocks }`) and `src/server/anchoring.ts` (`relocate(annotations, blocks)`). Use `fileHash` for the session dir name and `relocate` to set statuses on load — do not reimplement either.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun run typecheck` clean and `bun test` green (this phase adds tests); committed with this file's `Status:` and the root dashboard row both `DONE`.

---

## Files touched

- `src/server/annotation-service.ts` — CRUD over per-annotation JSON files + session dir + lock management
- `src/server/annotation-service.test.ts` — `bun:test`

## Pre-flight check (resume-after-compaction hint)

```sh
rg -n "export (async )?function (createSession|listAnnotations|saveAnnotation|deleteAnnotation|acquireLock|releaseLock|destroySession)" src/server/annotation-service.ts 2>/dev/null
bun test src/server/annotation-service.test.ts 2>/dev/null
```

## Data model — on-disk layout

Each annotation is a standalone JSON file (internal, machine-friendly, lossless — **not** a hand-rolled markdown format):

```
<tmpDir>/annotations/<basename>-<fileHash>/<annotation-id>.json
```

- `<tmpDir>` defaults to `/tmp/markdown-review` (overridable via the CLI `--tmp-dir` flag in Phase 6; the service takes it as a parameter — do not hardcode `/tmp`).
- `<basename>-<fileHash>` is the **session directory**. `basename` is the source file's name (sans path); `fileHash` is the hash from `loadDocument`. Two different files (or the same name in different dirs) get distinct sessions.
- Each file's name is `<annotation-id>.json` where the id is also `Annotation.id`.

Annotation JSON shape (exactly the `Annotation` interface from `src/shared/types.ts`):

```json
{
  "id": "abc123",
  "anchor": { "blockType": "heading", "textHash": "9f2a", "siblingOrdinal": 0 },
  "blockType": "heading",
  "blockText": "# Introduction",
  "blockLineRange": [1, 2],
  "comment": "Clarify the target audience in the first sentence.",
  "status": "ok",
  "createdAt": 1733251200000,
  "updatedAt": 1733251200000
}
```

Writes must be **atomic** (write to a temp file in the same dir, then `rename`) so a crash mid-write never leaves a half-written annotation that breaks the whole session load.

## The session lock

A single `mdr` process owns a session at a time:

- A lock file (e.g. `<session-dir>/.lock`) is written on session acquire, containing at least the owning **PID** and a **timestamp** (and ideally the server URL, so the refusal message can point at the running instance).
- `acquireLock` fails if a live lock exists. **Staleness:** if the lock's PID is no longer running (best-effort check, e.g. `process.kill(pid, 0)` throws `ESRCH`), treat the lock as stale and reclaim it — otherwise a crashed prior run would wedge the session forever.
- `releaseLock` removes the lock; call it on graceful shutdown.
- The README behavior: a second `mdr` on a locked, **live** session **refuses to start** with a message pointing at the running instance. The service surfaces this as a typed error/result; the CLI (Phase 6) turns it into the user-facing message.

## Service contract (names are guidance; keep stable once chosen)

```typescript
import type { Annotation } from "../shared/types";

export interface SessionOptions { tmpDir: string; fresh?: boolean; }

export interface Session {
  dir: string;                                  // the session directory
  list(): Promise<Annotation[]>;                // load all annotation JSON files
  save(a: Annotation): Promise<Annotation>;     // create-or-update (id present = update); sets updatedAt
  remove(id: string): Promise<void>;            // delete one annotation file
  release(): Promise<void>;                      // release lock (idempotent)
}

// Acquire (or reclaim) the lock for this file's session and return a handle.
// `--fresh` (fresh: true) wipes the session dir before starting clean.
// Throws/returns a typed "locked by PID … at URL …" error if a live lock is held by another process.
export function openSession(basename: string, fileHash: string, opts: SessionOptions): Promise<Session>;
```

- `save` generates the id for new annotations (short hash — reuse the same short-hash helper Phase 2 uses for `textHash`, or a random short id; it just has to be unique within the session) and stamps `createdAt`/`updatedAt` (`updatedAt` always; `createdAt` only on first write).
- `list` should be resilient: skip/parse-error a corrupt single file with a warning rather than failing the whole load (one bad annotation must not lose the rest).
- `--fresh` deletes the session dir contents (annotations + lock) before re-acquiring.

> The service does **not** call `relocate` itself — re-location runs at the API layer (Phase 5) where both the freshly parsed `blocks` and the loaded `annotations` are in hand. Keep storage and re-location separate.

## Work items

### 1. Session + lock
- [ ] `openSession(basename, fileHash, { tmpDir, fresh })` — derives `<tmpDir>/annotations/<basename>-<fileHash>`, honors `fresh`, acquires/reclaims the lock (PID liveness check for staleness), returns a `Session`.
- [ ] Typed "session is locked by PID … (URL …)" error when a live foreign lock exists.
- [ ] `release()` removes the lock and is safe to call twice.

### 2. CRUD
- [ ] `list()` reads every `*.json` in the session dir, tolerating a single corrupt file.
- [ ] `save()` atomic write (temp + rename), id generation for new annotations, `createdAt`/`updatedAt` stamping.
- [ ] `remove(id)` deletes the file (no error if already gone).

### 3. Tests
- [ ] Round-trip: `save` then `list` returns the annotation with stable id.
- [ ] `save` with an existing id updates in place and bumps `updatedAt` but preserves `createdAt`.
- [ ] `remove` deletes only the targeted file.
- [ ] Atomicity: no `*.tmp` residue after a successful `save`.
- [ ] Lock: second `openSession` against a **live** lock throws the typed error; a **stale** lock (dead PID) is reclaimed.
- [ ] `fresh: true` empties a previously-populated session.

## Acceptance criteria

- [ ] (a) `bun test src/server/annotation-service.test.ts` is green.
- [ ] (b) `bun run typecheck` clean.
- [ ] (c) After a `save`, the session dir contains exactly one `<id>.json` (no temp residue) whose contents equal the `Annotation` shape.
- [ ] (d) A second `openSession` while a live lock is held does not silently proceed — it errors with a message naming the holder.

## When done

1. Verify acceptance list ticked.
2. `bun run typecheck && bun test`.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 3 row to `DONE`.
4. Commit. Move to [`04-review-generator.md`](04-review-generator.md).
