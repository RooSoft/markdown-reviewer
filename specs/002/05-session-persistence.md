# Phase 5 — Session persistence: resume multi-file context across launches

**Status:** `TODO`
**Depends on:** Phase 1 (Server per-file state), Phase 3 (Frontend file zone)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

When the user reviews multiple files across several `mdr` launches, the session context (which files were visited) should persist. Relaunching `mdr` on any file from a previous session should restore all previously-navigated files as available in the sidebar.

## Problem

User workflow:
1. `mdr /Users/matt/project/specs/001.md` → navigate to `/Users/matt/project/specs/002.md`, `/Users/matt/project/specs/003.md` → annotate → quit
2. Next day: `mdr /Users/matt/project/specs/002.md` → should show `/Users/matt/project/specs/001.md` and `/Users/matt/project/specs/003.md` as already-linked files
3. Continue annotating `/Users/matt/project/specs/004.md`, `/Users/matt/project/specs/005.md` → quit
4. `mdr /Users/matt/project/specs/001.md` → should show all five files

The session is the explicit manifest of files that were loaded together. It survives across launches and includes files with zero annotations.

## Design: explicit session manifest

Do **not** infer a session by scanning every annotation directory in `<tmpDir>/annotations/`. That would mix unrelated reviews from the same tmpDir. Instead, persist explicit session membership.

### Files written per loaded source file annotation dir

Each file's annotation dir contains:
- `.path` — absolute source file path
- `.session` — session id for the multi-file review this file belongs to
- `*.json` — annotation files, if any

### Manifest location

```text
<tmpDir>/sessions/<sessionId>.json
```

### Manifest shape

```json
{
  "id": "fnv-or-random-session-id",
  "sessionRoot": "/absolute/path/to/entry-dir",
  "entryFilePath": "/absolute/path/to/entry.md",
  "files": [
    { "filePath": "/absolute/path/to/entry.md", "firstLoadedAt": 1760000000000, "lastLoadedAt": 1760000000000 },
    { "filePath": "/absolute/path/to/linked.md", "firstLoadedAt": 1760000001000, "lastLoadedAt": 1760000001000 }
  ],
  "updatedAt": 1760000001000
}
```

### Startup algorithm

1. Resolve the entry file to an absolute path.
2. Open/create the entry file annotation dir and write `.path`.
3. If that annotation dir has `.session`, load `<tmpDir>/sessions/<sessionId>.json`.
4. If no `.session` exists, create a new session id and manifest for this launch.
5. Write `.session` in the entry file annotation dir.
6. Ensure the entry file is present in the manifest.
7. Add every manifest file that still exists to the initial session file list, including files with zero annotations.

### Linked-file load algorithm

When `GET /api/files/:key` loads a linked file:
1. Resolve and validate the file.
2. Open/create that file's annotation dir.
3. Write `.path` and `.session`.
4. Add/update the file in the manifest immediately, even before it has annotations.
5. Return the loaded file state to the frontend.

This is what lets zero-annotation visited files reappear on relaunch.

## Implementation

### 1. Session metadata types and helpers

Add to `src/server/annotation-service.ts` or a new `src/server/session-manifest.ts`:

```ts
export interface SessionManifestFile {
  filePath: string;       // absolute path
  firstLoadedAt: number;
  lastLoadedAt: number;
}

export interface SessionManifest {
  id: string;
  sessionRoot: string;    // entry file parent directory; key namespace root
  entryFilePath: string;  // absolute path for the original entry file
  files: SessionManifestFile[];
  updatedAt: number;
}

export interface SessionFile {
  filePath: string;
  sessionDir: string;
  annotationCount: number;
  isEntry: boolean;
}
```

Required helpers:

```ts
export async function loadOrCreateSessionManifest(
  entryFilePath: string,
  tmpDir: string
): Promise<SessionManifest>;

export async function saveSessionManifest(
  manifest: SessionManifest,
  tmpDir: string
): Promise<void>;

export async function addFileToSessionManifest(
  manifest: SessionManifest,
  filePath: string,
  tmpDir: string
): Promise<SessionManifest>;

export async function writeSessionMarkers(
  filePath: string,
  tmpDir: string,
  sessionId: string
): Promise<void>;

export async function discoverSessionFiles(
  manifest: SessionManifest,
  tmpDir: string
): Promise<SessionFile[]>;
```

### 2. Marker writes

`openSession(filePath, { tmpDir, fresh, sessionId })` should write markers after the lock is acquired:

```ts
await writeFile(join(dir, ".path"), resolve(filePath), "utf-8");
if (opts.sessionId) {
  await writeFile(join(dir, ".session"), opts.sessionId, "utf-8");
}
```

`fresh` may remove annotation JSON files, but it must not silently attach a file to a different existing session. If `fresh` starts a new session, write the new `.session` value after clearing old metadata.

### 3. Discover files from the manifest only

`discoverSessionFiles` must iterate `manifest.files`, not `<tmpDir>/annotations/*`:

```ts
export async function discoverSessionFiles(
  manifest: SessionManifest,
  tmpDir: string
): Promise<SessionFile[]> {
  const results: SessionFile[] = [];

  for (const f of manifest.files) {
    if (!(await fileExists(f.filePath))) continue;

    const sessionDir = sessionDirForFile(f.filePath, tmpDir);
    const annotationCount = await countAnnotationJsonFiles(sessionDir);

    results.push({
      filePath: f.filePath,
      sessionDir,
      annotationCount,
      isEntry: f.filePath === manifest.entryFilePath,
    });
  }

  return results;
}
```

### 4. Server startup integration

In `startServer` after resolving the entry file and before building the `FileStore`:

```ts
const manifest = await loadOrCreateSessionManifest(filePath, tmpDir);
await writeSessionMarkers(filePath, tmpDir, manifest.id);
const sessionFiles = await discoverSessionFiles(manifest, tmpDir);
```

Build the initial file list from `sessionFiles`:

```ts
const initialFiles = sessionFiles.map((sf) => ({
  key: relativeKey(sf.filePath, sessionRoot),
  fileName: basename(sf.filePath),
  annotationCount: sf.annotationCount,
  isEntry: sf.isEntry,
}));
```

### 5. New API route: GET /api/session-files

Returns the manifest-backed session file list:

```json
{
  "files": [
    { "key": "001.md", "fileName": "001.md", "annotationCount": 2, "isEntry": true },
    { "key": "002.md", "fileName": "002.md", "annotationCount": 0, "isEntry": false }
  ]
}
```

### 6. Frontend init

In `src/frontend/app.js` init:

```js
var sessionRes = await api('/api/session-files');
files = sessionRes.files;
activeFileKey = files.find(function (f) { return f.isEntry; })?.key || files[0]?.key;
renderFileZone();
```

Discovered files that are not already in `fileState` are shown in the file zone and lazily fetched when clicked.

## Acceptance criteria

- [ ] `.path` and `.session` files are written when a file is loaded
- [ ] Session manifest is created under `<tmpDir>/sessions/<sessionId>.json`
- [ ] Loading a linked file adds it to the manifest immediately, even with 0 annotations
- [ ] `discoverSessionFiles` reads only the explicit manifest, not all of tmpDir
- [ ] `GET /api/session-files` returns manifest files with `key`, `fileName`, `annotationCount`, and `isEntry`
- [ ] Frontend populates the file zone from `/api/session-files` on init
- [ ] Relaunching `mdr` on any file with a `.session` marker restores the same manifest file list
- [ ] Entry file always appears in the file zone
- [ ] Files with 0 annotations appear if they were navigated
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/server/annotation-service.ts` — add `.path`/`.session` marker writes and session id option
- `src/server/session-manifest.ts` — **new file** for manifest helpers, or keep these helpers in `annotation-service.ts`
- `src/server/index.ts` — load/create manifest, update manifest on file load, add `GET /api/session-files`
- `src/frontend/app.js` — fetch session files on init, populate file zone
