# Phase 1 — Server: per-file state, on-demand loading, file key scoping

**Status:** `TODO`
**Depends on:** —
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

The server currently loads one document at startup and stores `source/blocks/fullHtml` as global in-memory state. For multi-file, we need per-file state and on-demand loading.

## Implementation

### 1. File key type

Add to `src/shared/types.ts`:

```ts
export type FileKey = string;  // relative path from entry dir (e.g. "specs/001.md")
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
  links: MdLink[];
  fileName: string;      // basename for display
  annotationCount: number;
  session: AnnotationSession; // one lock/session per loaded file
}

export class FileStore {
  private entries = new Map<FileKey, FileEntry>();
  private entryKey: FileKey;  // the entry file
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

### 3. Update startServer

Change `ServerOptions` to track the entry directory:

```ts
export interface ServerOptions {
  filePath: string;
  port?: number;
  tmpDir: string;
  fresh?: boolean;
}
```

On startup:
- Resolve the entry file to an absolute path and compute `sessionRoot = dirname(entryFilePath)`
- Parse the entry file with `loadDocument(entryFilePath, { sessionRoot, currentFileDir: dirname(entryFilePath) })`
- Open one annotation session for the entry file via `openSession(entryFilePath, { tmpDir, fresh, sessionId })`
- Create a `FileStore(sessionRoot)`, add the entry file with a key derived from `relative(sessionRoot, entryFilePath)`
- Store the `FileStore` instance on the server handler
- On any shutdown path, call `fileStore.releaseAll()`; do not release only the entry file lock

### 4. New routes

**GET /api/files** — list loaded files:
```json
{
  "files": [
    { "key": "specs/001.md", "fileName": "001.md", "annotationCount": 3 },
    { "key": "specs/002.md", "fileName": "002.md", "annotationCount": 1 }
  ],
  "activeKey": "specs/001.md"
}
```

**GET /api/files/:key** — load a file on-demand:
- Decode `:key` with `decodeURIComponent`; return 400 for malformed encoding
- Resolve the decoded key relative to `fileStore.getSessionRoot()` and normalize with `realpath`
- Validate the resolved path is an existing regular `.md` file
- **Acquire per-file lock** via `openSession(resolvedPath, { tmpDir, sessionId: manifest.id })` — throws `SessionLockedError` (409) if another `mdr` session holds it
- Parse with `loadDocument(resolvedPath, { sessionRoot: fileStore.getSessionRoot(), currentFileDir: dirname(resolvedPath) })`
- Add/update the session manifest immediately so zero-annotation visited files persist
- Add to `FileStore`
- Return: `{ source, blocks, fullHtml, links, fileName, key }`
- If already loaded, return cached data, including `fullHtml`, `blocks`, `links`, and `annotationCount`

**GET /api/files/:key/annotations** — get annotations for a specific file:
- Look up `fileStore.get(key)` and call that entry's `session.list()`
- Return: `{ annotations }`

**POST /api/files/:key/annotations** — create/update annotation for a specific file:
- Same as current `POST /api/annotations` but scoped to `:key`
- Look up `fileStore.get(key)` and persist through that entry's `session`
- Validate anchor against that entry's `blocks`
- **Generate `.r.md` for the file** (see below)
- Return: `{ annotation }`

**DELETE /api/files/:key/annotations/:id** — delete annotation:
- Same as current but scoped to `:key`
- Look up `fileStore.get(key)` and delete through that entry's `session`
- **Regenerate `.r.md` for the file** (see below)

### 5. Migrate existing routes

Current routes should continue to work for backward compatibility but delegate to the entry file:

- `GET /api/markdown` → `GET /api/files/{entryKey}/markdown` (proxy)
- `GET /api/annotations` → `GET /api/files/{entryKey}/annotations` (proxy)
- `POST /api/annotations` → `POST /api/files/{entryKey}/annotations` (proxy)
- `DELETE /api/annotations/:id` → `DELETE /api/files/{entryKey}/annotations/:id` (proxy)

### 6. Generate `.r.md` on every annotation change

After every annotation save or delete, regenerate the reviewed file for that file. The reviewed file is always current — no batch generation on Done.

```ts
// In annotation save handler, after persisting:
await generateReviewedFile(fileEntry);

async function generateReviewedFile(fileEntry: FileEntry) {
  const annotations = await fileEntry.session.list();
  const relocated = relocateAnnotations(fileEntry.blocks, annotations);
  const reviewed = buildReviewedMarkdown(fileEntry.source, relocated);
  const reviewedPath = reviewedFilePath(fileEntry.filePath);
  await writeFile(reviewedPath, reviewed, "utf-8");
}

// spec.md → spec.r.md
function reviewedFilePath(filePath: string): string {
  // /path/to/spec.md → /path/to/spec.r.md
  // This replaces the previous `_reviewed.md` output naming everywhere.
  return filePath.replace(/\.md$/i, ".r.md");
}
```

**Why on every annotation:**
- Reviewed file is always current — crash-safe
- Done is pure UI — no generation step
- Server shutdown (heartbeat) doesn't need to generate anything
- Cheap: splice HTML comments into cached source string

### 7. Frontend data injection

Currently `page.html` injects `<!--BLOCKS-->` (full HTML) and `<!--FILE_NAME-->` at startup. For multi-file:
- On initial load, inject the entry file's data (same as today)
- When switching files via JS, replace `#doc` innerHTML and update `#toolbar-file`
- No server-side re-render needed for subsequent files — frontend fetches via API

## Acceptance criteria

- [ ] `FileStore` class exists with all methods
- [ ] `GET /api/files` returns list of loaded files
- [ ] `GET /api/files/:key` decodes encoded slash keys, loads a new file or returns cached data with `fullHtml`, `blocks`, and `links`
- [ ] `GET /api/files/:key/annotations` returns file-scoped annotations
- [ ] `POST /api/files/:key/annotations` creates annotation scoped to file
- [ ] `DELETE /api/files/:key/annotations/:id` deletes annotation
- [ ] `.r.md` generated on every annotation save and delete using the active file's own session
- [ ] Existing routes (`/api/markdown`, `/api/annotations`) still work (proxy to entry file)
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/shared/types.ts` — add `FileKey` type
- `src/server/file-store.ts` — **new file**
- `src/server/index.ts` — add routes, integrate `FileStore`, keep a per-file session map, release all locks
- `src/server/annotation-service.ts` — no changes (already file-scoped)
