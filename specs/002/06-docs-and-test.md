# Phase 6 — Documentation, static integration test & route test

**Status:** `TODO`
**Depends on:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 6. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `specs/002-multi-file-review` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/002/06-docs-and-test.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** Phases 1–5 added per-file routes, link detection, the frontend file zone, the review modal + heartbeat lifecycle, and session persistence with merge. Reviewed output is `.mdr` and each carries the AGENT PROTOCOL block.
- **Definition of done:** all Work items + Acceptance criteria ticked; gates green (`bun run typecheck`, `bun test`); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit. **This is the last phase — STOP after committing and wait for operator approval before merging.**

---

## Files touched

- `AGENTS.md` — add a multi-file review section.
- `README.md` — update usage (if it exists).
- `test/integration-routes.ts` — **new file** (runtime route test + link-detection edge cases).
- This phase's **Static integration test** is a checklist *in this file* (a paper cross-check), not code.

## Pre-flight check (resume-after-compaction hint)

```sh
rg -n "Multi-file|mdr <file|\.mdr" AGENTS.md README.md 2>/dev/null
ls test/integration-routes.ts 2>/dev/null || echo "integration test not created yet"
# Frontend calls vs server routes — inputs to the static integration test below
rg -n "api\('/api/|fetch\(" src/frontend/app.js
rg -n "pathname ===|pathname.startsWith|req.method" src/server/index.ts
bun run typecheck && bun test
```

## 1. Update `AGENTS.md`

```markdown
## Multi-file review

- Start with a single entry file: `mdr <file.md>`
- Relative `.md` links in the rendered document are clickable
- Clicking a link loads the target file and adds it to the session
- Annotations are scoped per-file
- The sidebar shows a "Files" zone when >1 file is loaded
- Reviewed files are written as `<name>.mdr` after every annotation save or delete (always current)
- Each `.mdr` begins with an "AGENT PROTOCOL" comment block — the authoritative instructions for an
  agent applying the review. The Done modal's "Copy prompt" just lists the `.mdr` paths and defers to it.
- Done opens a modal with all reviewed `.mdr` paths and a consolidated prompt
- Sessions merge: launching a fresh file and then linking into a file from a previous session folds
  the new file into that existing session (never creates an overlapping one)
- Server stays alive after Done; it shuts down by heartbeat when the browser closes or by Ctrl-C
```

## 2. Update `README.md` (if present)

```markdown
## Usage

```bash
mdr <path-to-markdown> [options]
```

Start reviewing a markdown file. Click relative `.md` links in the rendered document to navigate to
related files and annotate them in the same session. Reviewed output is written next to each source
as `<name>.mdr`.

### Options
- `--port <n>` — Port for the local server (default: auto-select)
- `--tmp-dir <dir>` — Annotation session storage root
- `--no-open` — Don't auto-open the browser
- `--fresh` — Discard existing session, start clean
```

## 3. Static integration test (MANDATORY — paper cross-check, do NOT launch the app)

Read `src/frontend/app.js` against the `src/server/index.ts` router and fill this table. Every frontend call this feature adds/changes must map to a real route with matching **method**, **path** (including `:key`/`:id` params and `encodeURIComponent` usage), and **request/response field casing**. Any row you cannot match is a bug to fix **before** this phase is `DONE` — not a deferral.

| app.js call (method + path) | server route (method + path) | request fields match | response fields read match | matched? |
|---|---|---|---|---|
| `GET /api/files` | `GET /api/files` | — | `files[].{key,fileName,annotationCount}`, `activeKey` | ☐ |
| `GET /api/files/:key` (encoded) | `GET /api/files/:key` | — | `source, blocks, fullHtml, links, fileName, key` | ☐ |
| `GET /api/files/:key/annotations` | `GET /api/files/:key/annotations` | — | `annotations[]` | ☐ |
| `POST /api/files/:key/annotations` | `POST /api/files/:key/annotations` | `anchor, blockType, blockText, blockLineRange, comment, id?` | `annotation` | ☐ |
| `DELETE /api/files/:key/annotations/:id` | `DELETE /api/files/:key/annotations/:id` | — | `ok` (or 404 error body) | ☐ |
| `GET /api/session-files` | `GET /api/session-files` | — | `files[].{key,fileName,annotationCount,isEntry}` | ☐ |
| `GET /api/reviewed-files` | `GET /api/reviewed-files` | — | `files[].{key,reviewedPath,sourcePath,annotationCount}` | ☐ |
| `GET /api/ping` | `GET /api/ping` | — | `ok` | ☐ |
| `POST /api/done` (if still called) | `POST /api/done` | — | `ok, path` (no shutdown) | ☐ |

Also confirm:
- ☐ Every `data-md-link` value the frontend reads is the `resolvedKey` the server set (Phase 2), and the frontend `encodeURIComponent`s it before `GET /api/files/:key`.
- ☐ The Done flow reads `res.files` from `/api/reviewed-files` (not the old single `path`).
- ☐ No frontend call targets a path/method the router does not serve (scan for stale `/api/annotations` single-file calls that should now be file-scoped, except the intentional backward-compat proxies).

## 4. Runtime route + link-detection test

Create `test/integration-routes.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/server/index";
import { FileStore } from "../src/server/file-store";
import { detectMdLinks } from "../src/server/markdown-service";

describe("multi-file route surface", () => {
  let dir: string;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdr-multi-file-"));
    await writeFile(join(dir, "entry.md"), "# Entry\n\n[Next](./nested/next.md)\n", "utf-8");
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested/next.md"), "# Next\n", "utf-8");
  });

  afterEach(async () => {
    if (running) await running.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("exports required multi-file primitives", () => {
    expect(FileStore).toBeDefined();
    expect(typeof detectMdLinks).toBe("function");
  });

  it("serves required multi-file routes", async () => {
    running = await startServer({ filePath: join(dir, "entry.md"), tmpDir: join(dir, ".tmp"), port: 0 });
    const base = running.url;

    expect((await fetch(base + "/api/files")).status).toBe(200);

    const key = encodeURIComponent("nested/next.md");
    const file = await fetch(base + "/api/files/" + key);
    expect(file.status).toBe(200);
    const fileJson = await file.json();
    expect(fileJson.fullHtml).toContain("Next");
    expect(Array.isArray(fileJson.blocks)).toBe(true);

    expect((await fetch(base + "/api/files/" + key + "/annotations")).status).toBe(200);
    expect((await fetch(base + "/api/reviewed-files")).status).toBe(200);
    expect((await fetch(base + "/api/session-files")).status).toBe(200);
    expect((await fetch(base + "/api/ping")).status).toBe(200);
  });
});

describe("detectMdLinks", () => {
  it("marks current-file-relative markdown links only", async () => {
    // entry.md → nested/one.md; nested/one.md → ./two.md must resolve to nested/two.md (not root two.md).
  });
  it("rejects schemes, absolute paths, query strings, .mdr, and missing files", async () => {
    // http://x/y.md, mailto:a@b, /tmp/a.md, ./missing.md, ./file.md?download=1, ./review.mdr → none navigational.
  });
  it("allows hash fragments and case-insensitive .MD extensions", async () => {
    // ./Guide.MD#section resolves to Guide.MD and preserves originalUrl.
  });
});
```

## Work items

- [ ] Add the multi-file section to `AGENTS.md` (mentions `.mdr`, the AGENT PROTOCOL block, and session merge).
- [ ] Update `README.md` usage (if it exists).
- [ ] Complete the **Static integration test** table above — every row matched, all confirm boxes ticked; fix any mismatch found.
- [ ] Add `test/integration-routes.ts` (route surface + link-detection edge cases, including `.mdr` rejection).

## Acceptance criteria

- [ ] `AGENTS.md` updated with the multi-file section (`.mdr` + AGENT PROTOCOL + merge).
- [ ] `README.md` updated (if it exists).
- [ ] The static integration test table is fully ticked with no unmatched frontend calls.
- [ ] `bun test test/integration-routes.ts` passes.
- [ ] `bun run typecheck` passes.
- [ ] Full suite passes: `bun test`.

## When done

1. Verify the acceptance criteria above are fully ticked.
2. `bun run typecheck && bun test`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 6 to `DONE` (same commit).
5. Commit on the spec branch. **This is the last phase — STOP and wait for operator approval before merging to `main`.**
