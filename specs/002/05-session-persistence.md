# Phase 5 — Session persistence: resume multi-file context across launches

**Status:** `TODO`
**Depends on:** Phase 1 (Server per-file state), Phase 3 (Frontend file zone)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

When the user reviews multiple files across several `mdr` launches, the session context (which files were visited) should persist. Relaunching `mdr` on any file from a previous session should restore all previously-navigated files as available in the sidebar.

## Problem

User workflow:
1. `mdr specs/001.md` → navigate to 002, 003 → annotate → quit
2. Next day: `mdr specs/002.md` → should show 001 and 003 as already-linked files
3. Continue annotating 004, 005 → quit
4. `mdr specs/001.md` → should show 001-005

The "session" is the set of files that have annotations in the same tmpDir. It survives across launches.

## Design: implicit session discovery

No explicit session index file needed. The session is implicitly defined by which files have annotation directories in the tmpDir.

**Discovery algorithm:**
1. On startup, scan `<tmpDir>/annotations/` for directories
2. For each directory, check if it contains `.json` files (non-empty = has annotations)
3. Resolve the directory name back to a file path
4. Build the "session file list" from directories with annotations + the entry file

**Why this works:**
- Annotation dirs are named `<basename>-<pathHash>` — derived from the absolute file path
- If a dir has `.json` files, that file was annotated in a previous session
- The entry file is always included (even with 0 annotations)
- No separate index file to maintain or corrupt

## Implementation

### 1. Session discovery function

Add to `src/server/annotation-service.ts`:

```ts
/**
 * Discover files that have annotations in the tmpDir.
 * Returns array of { filePath, sessionDir, annotationCount }.
 */
export async function discoverSessionFiles(tmpDir: string): Promise<SessionFile[]> {
  const annotationsRoot = join(tmpDir, "annotations");
  const results: SessionFile[] = [];

  try {
    const entries = await readdir(annotationsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const dirPath = join(annotationsRoot, entry.name);
      const jsonFiles = await findJsonFiles(dirPath);

      if (jsonFiles.length > 0) {
        // Resolve dir name back to file path
        const filePath = resolveFilePathFromDirName(entry.name, tmpDir);
        if (filePath) {
          results.push({
            filePath,
            sessionDir: dirPath,
            annotationCount: jsonFiles.length,
          });
        }
      }
    }
  } catch {
    // tmpDir doesn't exist yet — empty session
  }

  return results;
}

export interface SessionFile {
  filePath: string;
  sessionDir: string;
  annotationCount: number;
}
```

### 2. Reverse mapping: dir name → file path

The annotation dir name is `<basename>-<pathHash>`. To reverse it, we need to find which file produces that hash. Two approaches:

**Approach A: Store the resolved path in the session dir.**

When `openSession` creates a session dir, also write a `.path` file:

```ts
// In openSession, after creating dir:
await writeFile(join(dir, ".path"), filePath, "utf-8");
```

Then discovery just reads `.path`. Simple, reliable, no reverse engineering.

**Approach B: Scan likely locations and hash-match.**

More complex, fragile. Skip.

**Decision: Approach A.** Write `.path` on session creation. Read it on discovery.

### 3. Update openSession

In `src/server/annotation-service.ts`, after creating the session dir:

```ts
// Write .path marker with ABSOLUTE path (for session discovery)
// Critical: must be absolute — same basename (e.g. readme.md, AGENTS.md)
// can exist in many projects. The absolute path disambiguates.
const pathFile = join(dir, ".path");
try {
  await writeFile(pathFile, resolvePath(filePath), "utf-8");
} catch {
  // Non-fatal — .path already exists or dir write failed
}
```

**Invariant:** `.path` always contains an absolute path. Never relative. This ensures `readme.md` in `/projects/A/` and `/projects/B/` are distinguished.

### 4. Update discoverSessionFiles to read .path

```ts
export async function discoverSessionFiles(tmpDir: string): Promise<SessionFile[]> {
  const annotationsRoot = join(tmpDir, "annotations");
  const results: SessionFile[] = [];

  try {
    const entries = await readdir(annotationsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const dirPath = join(annotationsRoot, entry.name);

      // Read .path to get the file path
      const pathFile = join(dirPath, ".path");
      let filePath: string;
      try {
        filePath = await readFile(pathFile, "utf-8");
      } catch {
        continue; // No .path — skip
      }

      // Count annotations
      const jsonFiles = await findJsonFiles(dirPath);

      results.push({
        filePath,
        sessionDir: dirPath,
        annotationCount: jsonFiles.length,
      });
    }
  } catch {
    // tmpDir doesn't exist yet
  }

  return results;
}

async function findJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((n) => n.endsWith(".json") && !n.startsWith("."));
}
```

### 5. Server startup: discover and expose session files

In `startServer` (Phase 1), after loading the entry file:

```ts
// Discover previously-annotated files
const sessionFiles = await discoverSessionFiles(tmpDir);

// Build initial file list for frontend
const initialFiles = sessionFiles.map((sf) => ({
  key: relativeKey(sf.filePath, entryDir),
  fileName: basename(sf.filePath),
  annotationCount: sf.annotationCount,
  filePath: sf.filePath,
}));

// Add entry file if not already in list
if (!initialFiles.find((f) => f.filePath === filePath)) {
  initialFiles.push({
    key: relativeKey(filePath, entryDir),
    fileName: basename(filePath),
    annotationCount: 0,
    filePath,
  });
}
```

### 6. New API route: GET /api/session-files

Returns the discovered session file list:

```
GET /api/session-files
→ { files: [{ key, fileName, annotationCount }] }
```

Frontend calls this on init to populate the file zone.

### 7. Frontend: populate file zone from discovered session

In `app.js` init:

```js
async function init() {
  // ... existing code ...

  // Discover session files
  var sessionRes = await api('/api/session-files');
  files = sessionRes.files;

  // Set active file to entry file
  activeFileKey = files.find(function (f) { return f.isEntry; })?.key || files[0]?.key;

  renderFileZone();  // shows zone if >1 file
}
```

### 8. File zone: show annotation count badge

Each file in the zone shows its annotation count. Files with 0 annotations still appear (they were navigated previously).

## Acceptance criteria

- [ ] `.path` file written on session creation
- [ ] `discoverSessionFiles` returns files with annotations from tmpDir
- [ ] `GET /api/session-files` returns discovered file list
- [ ] Frontend populates file zone from discovered session on init
- [ ] Relaunching `mdr` on a previously-annotated file shows all session files
- [ ] Entry file always appears in file zone
- [ ] Files with 0 annotations appear if they were navigated (have .path)
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/server/annotation-service.ts` — add `.path` write, add `discoverSessionFiles`
- `src/server/index.ts` — add `GET /api/session-files`, call discovery on startup
- `src/frontend/app.js` — fetch session files on init, populate file zone
