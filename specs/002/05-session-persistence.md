# Phase 5 — Session persistence: resume multi-file context across launches

**Status:** `TODO`
**Depends on:** Phase 1 (Server per-file state), Phase 3 (Frontend file zone)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 5. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `specs/002-multi-file-review` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/002/05-session-persistence.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** Phase 1 added `FileStore`, per-file sessions, and `GET /api/files`; `openSession(filePath, { tmpDir, fresh })` exists. Phase 3 added the file zone and calls `GET /api/session-files` (with a fallback) plus refreshes it after every load.
- **Definition of done:** all Work items + Acceptance criteria ticked; gates green (`bun run typecheck`, `bun test`); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit.

---

## What changes

When a user reviews files across several `mdr` launches, the set of visited files should persist. Relaunching `mdr` on **any** file from a previous session restores all previously-navigated files in the sidebar — including files with zero annotations. The session is an **explicit manifest**, not an inference over the tmpDir.

This phase also implements **session merge** (root invariant *"Sessions merge, never split or overlap"*): if you launch a fresh file and then navigate into a file that already belongs to a different, pre-existing session, your run is absorbed into that pre-existing session.

## Motivating workflow

1. `mdr /p/specs/001.md` → navigate to `002.md`, `003.md` → annotate → quit. Session S = {001, 002, 003}.
2. Next day: `mdr /p/specs/002.md` → shows `001.md` and `003.md` as already-linked.
3. Continue to `004.md`, `005.md` → quit. S = {001..005}.
4. `mdr /p/specs/001.md` → shows all five.

Merge case (the gap this phase closes): `mdr /p/specs/099.md` (fresh → new session T = {099}), then click a link to `001.md` (∈ S). Result: **099 joins S**; T is discarded. Re-opening any of 001..005 or 099 now shows the union.

## Data model

### Files written per loaded source-file annotation dir
- `.path` — absolute source file path.
- `.session` — the session id this file currently belongs to (a pointer to its manifest).
- `*.json` — annotation files, if any.

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
    { "filePath": "/abs/entry.md",  "firstLoadedAt": 1760000000000, "lastLoadedAt": 1760000000000 },
    { "filePath": "/abs/linked.md", "firstLoadedAt": 1760000001000, "lastLoadedAt": 1760000001000 }
  ],
  "updatedAt": 1760000001000
}
```

> **Membership source of truth = `manifest.files` (absolute paths).** The per-file `.session` marker is only a *pointer* a file uses to find its manifest. If a marker ever points at a missing manifest, recovery scans the session manifests for one whose `files` list contains that path (see Startup, step 3b). `sessionRoot`/`entryFilePath` are advisory after a merge — `isEntry` is best-effort and FileKeys are always recomputed from the current run's `sessionRoot`.

```ts
export interface SessionManifestFile { filePath: string; firstLoadedAt: number; lastLoadedAt: number; }

export interface SessionManifest {
  id: string;
  sessionRoot: string;
  entryFilePath: string;
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

Helpers (in `src/server/session-manifest.ts`, or kept in `annotation-service.ts`):

```ts
export async function loadOrCreateSessionManifest(entryFilePath: string, tmpDir: string): Promise<SessionManifest>;
export async function saveSessionManifest(manifest: SessionManifest, tmpDir: string): Promise<void>;
export async function addFileToSessionManifest(manifest: SessionManifest, filePath: string, tmpDir: string): Promise<SessionManifest>;
export async function writeSessionMarkers(filePath: string, tmpDir: string, sessionId: string): Promise<void>;
export async function discoverSessionFiles(manifest: SessionManifest, tmpDir: string): Promise<SessionFile[]>;
export async function readSessionMarker(filePath: string, tmpDir: string): Promise<string | null>;       // .session contents or null
export async function mergeSessions(currentId: string, targetId: string, tmpDir: string, ownedPaths: string[]): Promise<SessionManifest>;  // returns surviving (target) manifest
```

## Algorithms

### Marker writes
`openSession(filePath, { tmpDir, fresh, sessionId })` writes markers **after** acquiring the lock:
```ts
await writeFile(join(dir, ".path"), resolve(filePath), "utf-8");
if (opts.sessionId) await writeFile(join(dir, ".session"), opts.sessionId, "utf-8");
```
`fresh` may delete annotation JSON but must **not** silently attach a file to a different existing session; if `fresh` starts a new session, write the new `.session` after clearing old metadata.

### Discover from the manifest only (never scan tmpDir)
```ts
export async function discoverSessionFiles(manifest, tmpDir) {
  const results = [];
  for (const f of manifest.files) {
    if (!(await fileExists(f.filePath))) continue;                 // skip deleted files
    const sessionDir = sessionDirForFile(f.filePath, tmpDir);
    results.push({
      filePath: f.filePath,
      sessionDir,
      annotationCount: await countAnnotationJsonFiles(sessionDir),
      isEntry: f.filePath === manifest.entryFilePath,
    });
  }
  return results;
}
```

### Startup
1. Resolve the entry file to an absolute path; open/create its annotation dir and write `.path`.
2. If the entry dir has a `.session` marker → `sessionId = that`; load `<tmpDir>/sessions/<sessionId>.json`.
3. Else:
   - **(3a)** Create a new session id + manifest for this launch, and write `.session`.
   - **(3b) Recovery:** before creating new, if the entry dir has a `.session` pointing at a *missing* manifest, scan `<tmpDir>/sessions/*.json` for a manifest whose `files` contains this entry's absolute path; if found, adopt it (rewrite the marker) instead of creating a new session.
4. Ensure the entry file is present in the manifest (`addFileToSessionManifest`).
5. Add every manifest file that **still exists** to the initial file list, including zero-annotation files (`discoverSessionFiles`).

### Linked-file load — with merge (`GET /api/files/:key`)
When loading a linked file `T` (after resolve + validate + lock per Phase 1):

```text
existing = readSessionMarker(T, tmpDir)          // T's current .session, or null
current  = server's running session id

if existing == null OR existing == current:
    # normal add — T joins the current session
    writeSessionMarkers(T, tmpDir, current)
    addFileToSessionManifest(currentManifest, T.filePath, tmpDir)
else:
    # T belongs to a DIFFERENT, pre-existing session → MERGE current INTO existing
    target = existing
    survivingManifest = mergeSessions(current, target, tmpDir, ownedPaths = fileStore.list().map(filePath))
    server adopts `target` as its running session id            # subsequent loads write .session = target
    currentManifest := survivingManifest
    ensure T is present (it already is) and T.filePath markers point at target
```

`mergeSessions(currentId, targetId, tmpDir, ownedPaths)`:
1. Load `currentManifest` (= `currentId`) and `targetManifest` (= `targetId`).
2. Union: for each file in `currentManifest.files`, `addFileToSessionManifest(targetManifest, f.filePath, tmpDir)` (preserve the **earliest** `firstLoadedAt`, latest `lastLoadedAt`).
3. Re-point markers we own: for each path in `ownedPaths` (files this run loaded → we hold their locks), write `.session = targetId`. Best-effort for any `currentManifest.files` path not currently owned/locked (the manifest union already guarantees membership even if a marker write is skipped — startup recovery 3b covers a stale marker).
4. `saveSessionManifest(targetManifest)`; delete `<tmpDir>/sessions/<currentId>.json`.
5. Return `targetManifest`.

> **Why current→target (target wins):** the user's mental model is "the new file joins the existing session." The pre-existing (linked) session is canonical; the just-started run is absorbed. We only *must* rewrite markers for files we own (locks held), which keeps the operation safe against a second `mdr` holding another file. Two already-established sessions colliding still merge into the linked file's session — bounded by the current run's owned files.

### `GET /api/session-files`
Returns the manifest-backed list (the file zone's authoritative source; Phase 3 re-fetches it after every load so merges/restores reflect immediately):
```json
{ "files": [
  { "key": "001.md", "fileName": "001.md", "annotationCount": 2, "isEntry": true },
  { "key": "002.md", "fileName": "002.md", "annotationCount": 0, "isEntry": false }
] }
```
`key = relativeKey(sf.filePath, sessionRoot)` using the **current run's** `sessionRoot`.

### Server startup integration
```ts
const manifest = await loadOrCreateSessionManifest(filePath, tmpDir);
await writeSessionMarkers(filePath, tmpDir, manifest.id);
const sessionFiles = await discoverSessionFiles(manifest, tmpDir);
const initialFiles = sessionFiles.map((sf) => ({
  key: relativeKey(sf.filePath, sessionRoot),
  fileName: basename(sf.filePath),
  annotationCount: sf.annotationCount,
  isEntry: sf.isEntry,
}));
```
Keep a mutable reference to the running session id + current manifest so the linked-file merge path can update them.

### Frontend init
```js
var sessionRes = await api('/api/session-files');
files = sessionRes.files;
activeFileKey = files.find(function (f) { return f.isEntry; })?.key || files[0]?.key;
renderFileZone();
```
Files not yet in `fileState` show in the zone and are lazily fetched when clicked (Phase 3).

## Work items

Tick each box as you complete it. Commit after each logical group.

- [ ] Add session types + helpers (`loadOrCreateSessionManifest`, `saveSessionManifest`, `addFileToSessionManifest`, `writeSessionMarkers`, `discoverSessionFiles`, `readSessionMarker`, `mergeSessions`).
- [ ] Make `openSession` accept `sessionId` and write `.path`/`.session` after locking; handle `fresh` without silently re-attaching to another session.
- [ ] `discoverSessionFiles` reads only `manifest.files` (never scans tmpDir); skips deleted files.
- [ ] Startup: load/create manifest, write entry markers, include zero-annotation files, with recovery (3b) when a marker points at a missing manifest.
- [ ] Linked-file load implements the merge branch (current→target) and re-points only owned markers; server adopts the target id for the rest of the run.
- [ ] Add `GET /api/session-files`.
- [ ] Frontend init populates the file zone from `/api/session-files`.

## Acceptance criteria

- [ ] `.path` and `.session` are written when a file is loaded.
- [ ] The manifest is created under `<tmpDir>/sessions/<sessionId>.json`.
- [ ] Loading a linked file adds it to the manifest immediately, even with 0 annotations.
- [ ] `discoverSessionFiles` reads only the explicit manifest, not all of tmpDir.
- [ ] `GET /api/session-files` returns manifest files with `key`, `fileName`, `annotationCount`, `isEntry`.
- [ ] Relaunching `mdr` on any file with a `.session` marker restores the same manifest file list (entry file always present; zero-annotation visited files present).
- [ ] **Merge:** launching a fresh file and then linking into a pre-existing session folds the fresh run into that session — one surviving manifest containing the union, the fresh session's manifest deleted, and no file claimed by two sessions. Re-opening any member shows the union.
- [ ] **Recovery:** a `.session` marker pointing at a missing manifest is reconciled at startup by finding the manifest whose `files` contains the path.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes (include a merge unit/integration test and a recovery test).

## When done

1. Verify the acceptance criteria above are fully ticked.
2. `bun run typecheck && bun test`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 5 to `DONE` (same commit).
5. Commit on the spec branch. Move to [`06-docs-and-test.md`](06-docs-and-test.md).

## Files touched

- `src/server/session-manifest.ts` — **new file** (manifest helpers + `mergeSessions`), or keep these in `annotation-service.ts`.
- `src/server/annotation-service.ts` — `.path`/`.session` marker writes + `sessionId` option.
- `src/server/index.ts` — load/create manifest, linked-file merge branch, running-session-id state, `GET /api/session-files`.
- `src/frontend/app.js` — fetch session files on init (Phase 3 also re-fetches after each load).
