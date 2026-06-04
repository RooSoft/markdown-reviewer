# Phase 1 — Server: per-file state, on-demand loading, file key scoping, `.mdr` generation

**Status:** `TODO`
**Depends on:** —
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 1. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `specs/002-multi-file-review` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/002/01-server-multi-file.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** none — this is the first phase.
- **Definition of done:** all Work items + Acceptance criteria ticked; gates green (`bun run typecheck`, `bun test`; `curl` smoke tests for the new `/api/files*` routes); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit.

---

## Files touched

- `src/shared/types.ts` — add `FileKey` type.
- `src/server/file-store.ts` — **new file** (`FileStore` class + `FileEntry`).
- `src/server/index.ts` — add `/api/files*` routes, integrate `FileStore`, keep one session per loaded file, release all locks on shutdown, regenerate `.mdr` on save/delete.
- `src/review/generator.ts` — change the reviewed-file suffix to `.mdr` and update the `AGENT_PROTOCOL_BLOCK` wording (see **Reuse the existing generator** below).
- `src/review/generator.test.ts` — update the suffix/path assertions to `.mdr`.
- `src/server/annotation-service.ts` — no behavioral change (already file-scoped).

## Pre-flight check (resume-after-compaction hint)

```sh
# Reviewed-file output naming + the protocol block that must move to .mdr
rg -n "_reviewed|\.mdr|AGENT PROTOCOL|SOURCE FILE|BATCH" src/review/generator.ts
# Existing single-file generator API you will reuse (do NOT invent a new builder)
rg -n "export function generateReview|export async function writeReview|export function relocate" src/review/generator.ts src/server/anchoring.ts
# Current global server state you are replacing with per-file state
rg -n "loadDocument|openSession|Bun.serve|/api/annotations|/api/done|bunServer.stop|session.release|resolveStopped" src/server/index.ts
# Confirm FileStore does not exist yet
ls src/server/file-store.ts 2>/dev/null || echo "file-store.ts not created yet"
bun run typecheck && bun test
```

If a step's outputs show the code already exists, that step is done — skip it and re-run its tests to confirm.

## Data model

### 1. File key type

Add to `src/shared/types.ts`:

```ts
export type FileKey = string;  // relative path from the session root (e.g. "specs/001.md")
```

### 2. FileStore

Create `src/server/file-store.ts`:

```ts
export interface FileEntry {
  key: FileKey;
  filePath: string;      // absolute path
  source: string;
  fileHash: string;
  blocks: BlockNode[];
  fullHtml: string;
  links: MdLink[];        // from Phase 2; empty array is valid until Phase 2 lands
  fileName: string;       // basename for display
  annotationCount: number;
  session: AnnotationSession; // one lock/session per loaded file
}

export class FileStore {
  private entries = new Map<FileKey, FileEntry>();
  private entryKey: FileKey;   // the entry file
  private sessionRoot: string; // entry file's parent directory; key namespace root

  constructor(sessionRoot: string) {}

  setEntry(key: FileKey): void
  has(key: FileKey): boolean
  get(key: FileKey): FileEntry | undefined
  add(entry: FileEntry): void
  list(): FileEntry[]
  getEntryKey(): FileKey
  getSessionRoot(): string
  releaseAll(): Promise<void> // releases every FileEntry.session lock
}
```

> `MdLink` is defined in Phase 2. For Phase 1, type `links` as `MdLink[]` and populate it with `[]` (link detection is wired in Phase 2). Do not block Phase 1 on Phase 2.

### 3. Reviewed-file suffix is `.mdr`

Reviewed output uses the `.mdr` suffix: `spec.md` → `spec.mdr`. This replaces the previous `_reviewed.md` naming **everywhere**. Because `.mdr` is not a `.md` file, generated review files are never re-loaded as sources and never marked as navigational links (Phase 2 only marks `.md`).

```ts
// spec.md → spec.mdr  (the single source of truth for the suffix)
function reviewedFilePath(filePath: string): string {
  return filePath.replace(/\.md$/i, ".mdr");
}
```

## Reuse the existing generator (do NOT invent a new builder)

`src/review/generator.ts` already exports the functions you need. **Do not** create a parallel `buildReviewedMarkdown()`/`generateReviewedFile()` — that would bypass the AGENT PROTOCOL block.

- `generateReview(source: string, relocated: Relocated[], fileBasename: string): string` — builds the full reviewed-file string. It already prepends the `AGENT_PROTOCOL_BLOCK` and the summary. **Keep using it** so every `.mdr` carries the protocol block.
- `writeReview(sourcePath: string, source: string, relocated: Relocated[]): Promise<string>` — computes the output path, calls `generateReview`, and writes atomically (temp file + rename). Returns the output path.
- `relocate(annotations: Annotation[], blocks: BlockNode[]): Relocated[]` — from `src/server/anchoring.ts`.

**Two edits to `src/review/generator.ts` are required in this phase:**

1. **Change the output suffix to `.mdr`.** In `writeReview`, replace the `_reviewed.md` basename construction with `reviewedFilePath()` semantics:

   ```ts
   // BEFORE: const outputBasename = `${nameWithoutExt}_reviewed.md`;
   // AFTER:  output path = sourcePath.replace(/\.md$/i, ".mdr")
   ```
   Update the temp-file name accordingly and the doc-comments that say `_reviewed.md`.

2. **Update the `AGENT_PROTOCOL_BLOCK` wording so it names the `.mdr` suffix.** The block currently says:
   - `SOURCE FILE = this file's path without the \`_reviewed\` suffix.`
   - `BATCH = if several _reviewed.md files are given, process them all together; ...`

   Change these two lines to:
   - `SOURCE FILE = this file's path with the \`.mdr\` extension replaced by \`.md\` (e.g. spec.mdr → spec.md).`
   - `BATCH = if several \`.mdr\` files are given, process them all together; first list them and flag any with no matching source (or expected source not covered).`

   Do **not** change the TRIAGE / APPLY / ASK / CONSISTENCY / PRESERVE / REPORT semantics — only the suffix wording. Keep the block a single well-formed HTML comment (no nested `-->`; the existing regression assertion in `generator.test.ts` guards this — keep it green).

### Per-file regeneration helper

After every annotation save or delete for a file, regenerate that file's `.mdr` using the file's own session and cached source/blocks:

```ts
async function regenerateReviewedFile(entry: FileEntry): Promise<void> {
  const annotations = await entry.session.list();
  const relocated = relocate(annotations, entry.blocks);
  await writeReview(entry.filePath, entry.source, relocated); // writes <name>.mdr, carries the protocol block
}
```

**Why on every annotation:** the `.mdr` is always current (crash-safe), Done becomes pure UI, heartbeat shutdown needs no generation step, and it is cheap (splice HTML comments into the cached source string).

## API contract

### Update `startServer`

```ts
export interface ServerOptions {
  filePath: string;
  port?: number;
  tmpDir: string;
  fresh?: boolean;
}
```

On startup:
- Resolve the entry file to an absolute path and compute `sessionRoot = dirname(entryFilePath)`.
- Parse the entry file with `loadDocument(entryFilePath, { sessionRoot, currentFileDir: dirname(entryFilePath) })` (the `opts` argument is added in Phase 2; until then `loadDocument(entryFilePath)` is fine and `links` is `[]`).
- Open one annotation session for the entry file via `openSession(entryFilePath, { tmpDir, fresh, sessionId })` (the `sessionId` option is added in Phase 5; until then omit it).
- Create a `FileStore(sessionRoot)`, add the entry file with a key derived from `relative(sessionRoot, entryFilePath)`, and `setEntry()` that key.
- Store the `FileStore` instance so the request handler and shutdown paths can reach it.
- On **every** shutdown path, call `fileStore.releaseAll()` — do not release only the entry file's lock.

### Routes

**GET /api/files** — list the files currently **loaded in memory** this run (source of truth for what the server has parsed), plus the active key:
```json
{
  "files": [
    { "key": "specs/001.md", "fileName": "001.md", "annotationCount": 3 },
    { "key": "specs/002.md", "fileName": "002.md", "annotationCount": 1 }
  ],
  "activeKey": "specs/001.md"
}
```
> **Relationship to `/api/session-files` (Phase 5):** `/api/files` reflects only files the server has loaded **this run**. The sidebar **file zone** is populated from `/api/session-files` (Phase 5), which reads the persistent manifest and can include previously-visited files not yet loaded this run. The frontend treats `/api/session-files` as authoritative for zone membership and lazily loads a file's `fullHtml`/`blocks` via `GET /api/files/:key` when it is first clicked. Keep both routes; they answer different questions.

**GET /api/files/:key** — load a file on-demand:
- Decode `:key` with `decodeURIComponent`; return 400 for malformed encoding.
- Resolve the decoded key relative to `fileStore.getSessionRoot()` and normalize with `realpath`.
- Validate the resolved path is an existing regular `.md` file.
- **Acquire a per-file lock** via `openSession(resolvedPath, { tmpDir, sessionId: manifest.id })` — throws `SessionLockedError` (409) if another `mdr` session holds it. (`sessionId` lands in Phase 5.)
- Parse with `loadDocument(resolvedPath, { sessionRoot: fileStore.getSessionRoot(), currentFileDir: dirname(resolvedPath) })` (Phase 2).
- Add/update the session manifest immediately so zero-annotation visited files persist (Phase 5).
- Add to `FileStore`.
- Return `{ source, blocks, fullHtml, links, fileName, key }`.
- If already loaded, return cached data, including `fullHtml`, `blocks`, `links`, and `annotationCount`.

**GET /api/files/:key/annotations** — look up `fileStore.get(key)` and return `{ annotations }` from that entry's `session.list()`.

**POST /api/files/:key/annotations** — create/update annotation scoped to `:key`:
- Look up `fileStore.get(key)` and persist through that entry's `session`.
- Validate the anchor against that entry's `blocks` (same tier-1/tier-2 check as the current `POST /api/annotations`).
- **Regenerate `.mdr`** for the file via `regenerateReviewedFile(entry)`.
- Return `{ annotation }`.

**DELETE /api/files/:key/annotations/:id** — delete annotation scoped to `:key`:
- Look up `fileStore.get(key)`, check existence, delete through that entry's `session`.
- **Regenerate `.mdr`** for the file via `regenerateReviewedFile(entry)`.
- Return `{ ok: true }` or 404.

### Migrate existing routes (backward compatibility)

The current single-file routes must keep working by delegating to the entry file:

- `GET /api/markdown` → entry file's `{ source, blocks }`
- `GET /api/annotations` → entry file's annotations
- `POST /api/annotations` → entry file's annotation create/update (also regenerates the entry's `.mdr`)
- `DELETE /api/annotations/:id` → entry file's annotation delete (also regenerates the entry's `.mdr`)

(`POST /api/done` lifecycle changes are owned by Phase 4; in Phase 1 it may keep emitting the entry file's reviewed output, now `.mdr`.)

### Frontend data injection

- On initial load, inject the entry file's data into `page.html` as today (`<!--BLOCKS-->`, `<!--FILE_NAME-->`).
- When switching files via JS, the frontend replaces `#doc` innerHTML and updates `#toolbar-file` (Phase 3). No server-side re-render for subsequent files.

## Work items

Tick each box as you complete it. Commit after each logical group.

### 1. Types & store
- [ ] Add `FileKey` to `src/shared/types.ts`.
- [ ] Create `src/server/file-store.ts` with `FileEntry` + `FileStore` (all methods, `releaseAll`).

### 2. Generator → `.mdr` + protocol block wording
- [ ] Change `writeReview` output suffix from `_reviewed.md` to `.mdr` (`reviewedFilePath` semantics) and update temp-file name + doc-comments.
- [ ] Update `AGENT_PROTOCOL_BLOCK` `SOURCE FILE` and `BATCH` lines to name the `.mdr` suffix; leave TRIAGE/APPLY/ASK/etc. untouched; keep it one well-formed HTML comment.
- [ ] Update `src/review/generator.test.ts` golden/path assertions to `.mdr` and keep the "one `<!--`/one `-->` in the protocol block" regression assertion green.

### 3. Server per-file state & routes
- [ ] Resolve entry file, compute `sessionRoot`, build `FileStore`, store it on the handler; release all locks on every shutdown path.
- [ ] Add `GET /api/files`, `GET /api/files/:key`, `GET /api/files/:key/annotations`, `POST /api/files/:key/annotations`, `DELETE /api/files/:key/annotations/:id`.
- [ ] Add `regenerateReviewedFile(entry)` and call it after every save/delete (per-file and on the proxied entry routes).
- [ ] Keep `/api/markdown`, `/api/annotations`, `DELETE /api/annotations/:id` working by delegating to the entry file.

## Acceptance criteria

- [ ] `FileStore` class exists with all methods, including `releaseAll()`.
- [ ] `GET /api/files` returns the loaded-file list and `activeKey`.
- [ ] `GET /api/files/:key` decodes encoded-slash keys, loads a new file or returns cached data with `fullHtml`, `blocks`, and `links`, and returns 409 if the file is locked by another session.
- [ ] `GET /api/files/:key/annotations` returns file-scoped annotations.
- [ ] `POST /api/files/:key/annotations` creates an annotation scoped to the file and regenerates its `.mdr`.
- [ ] `DELETE /api/files/:key/annotations/:id` deletes and regenerates its `.mdr` (404 when missing).
- [ ] Reviewed output is `<name>.mdr` and its first bytes are the AGENT PROTOCOL block whose `SOURCE FILE` line names the `.mdr`→`.md` mapping.
- [ ] Existing routes (`/api/markdown`, `/api/annotations`) still work (delegate to the entry file).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes (generator suffix/protocol assertions updated and green).

## When done

1. Verify the acceptance criteria above are fully ticked.
2. `bun run typecheck && bun test`, plus `curl` smoke tests for `GET /api/files` and `GET /api/files/:key`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 1 to `DONE` (same commit).
5. Commit on the spec branch. Move to [`02-link-detection.md`](02-link-detection.md).
