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
  fileName: string;      // basename for display
}

export class FileStore {
  private entries = new Map<FileKey, FileEntry>();
  private entryKey: FileKey;  // the entry file

  constructor() {}

  setEntry(key: FileKey): void
  has(key: FileKey): boolean
  get(key: FileKey): FileEntry | undefined
  add(entry: FileEntry): void
  list(): FileEntry[]
  getEntryKey(): FileKey
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
- Parse the entry file
- Create a `FileStore`, add the entry file with key derived from `filePath` relative to its parent dir
- Store `FileStore` instance on the server handler

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
- Resolve `:key` as relative to entry dir
- Validate file exists
- **Acquire per-file lock** via `openSession(resolvedPath, { tmpDir })` — throws `SessionLockedError` (409) if another `mdr` session holds it
- Parse with existing `loadDocument`
- Add to `FileStore`
- Return: `{ source, blocks, fileName }`
- If already loaded, return cached data

**GET /api/files/:key/annotations** — get annotations for a specific file:
- Delegate to existing `session.list()` (already scoped by file path)
- Return: `{ annotations }`

**POST /api/files/:key/annotations** — create/update annotation for a specific file:
- Same as current `POST /api/annotations` but scoped to `:key`
- Validate anchor against the file's blocks
- **Generate `.r.md` for the file** (see below)
- Return: `{ annotation }`

**DELETE /api/files/:key/annotations/:id** — delete annotation:
- Same as current but scoped to `:key`
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
await generateReviewedFile(fileEntry, session);

async function generateReviewedFile(fileEntry: FileEntry, session: AnnotationSession) {
  const annotations = await session.list();
  const relocated = relocateAnnotations(fileEntry.blocks, annotations);
  const reviewed = buildReviewedMarkdown(fileEntry.source, relocated);
  const reviewedPath = reviewedFilePath(fileEntry.filePath);
  await writeFile(reviewedPath, reviewed, "utf-8");
}

// spec.md → spec.r.md
function reviewedFilePath(filePath: string): string {
  // /path/to/spec.md → /path/to/spec.r.md
  return filePath.replace(/\.md$/, ".r.md");
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
- [ ] `GET /api/files/:key` loads a new file or returns cached data
- [ ] `GET /api/files/:key/annotations` returns file-scoped annotations
- [ ] `POST /api/files/:key/annotations` creates annotation scoped to file
- [ ] `DELETE /api/files/:key/annotations/:id` deletes annotation
- [ ] `.r.md` generated on every annotation save and delete
- [ ] Existing routes (`/api/markdown`, `/api/annotations`) still work (proxy to entry file)
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/shared/types.ts` — add `FileKey` type
- `src/server/file-store.ts` — **new file**
- `src/server/index.ts` — add routes, integrate `FileStore`
- `src/server/annotation-service.ts` — no changes (already file-scoped)
