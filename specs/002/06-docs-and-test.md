# Phase 6 — Documentation and testing

**Status:** `TODO`
**Depends on:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

Update project documentation to reflect multi-file capabilities and add a static integration test that validates the route surface without starting a server.

## Implementation

### 1. Update AGENTS.md

Add a section describing multi-file review:

```markdown
## Multi-file review

- Start with a single entry file: `mdr <file.md>`
- Relative `.md` links in the rendered document are clickable
- Clicking a link loads the target file and adds it to the session
- Annotations are scoped per-file
- The sidebar shows a "Files" zone when >1 file is loaded
- `.r.md` files are generated/updated after every annotation save or delete
- Done opens a modal with all reviewed `.r.md` paths and a consolidated prompt
- Server stays alive after Done; it shuts down by heartbeat when the browser closes or by Ctrl-C
```

### 2. Update README.md

If there's a user-facing README, update the usage section:

```markdown
## Usage

```bash
mdr <path-to-markdown> [options]
```

Start reviewing a markdown file. Click relative `.md` links in the rendered document to navigate to related files and annotate them in the same session.

### Options

- `--port <n>` — Port for the local server (default: auto-select)
- `--tmp-dir <dir>` — Annotation session storage root
- `--no-open` — Don't auto-open the browser
- `--fresh` — Discard existing session, start clean
```

### 3. Integration route and link tests

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
    const files = await fetch(base + "/api/files");
    expect(files.status).toBe(200);

    const key = encodeURIComponent("nested/next.md");
    const file = await fetch(base + "/api/files/" + key);
    expect(file.status).toBe(200);
    const fileJson = await file.json();
    expect(fileJson.fullHtml).toContain("Next");
    expect(Array.isArray(fileJson.blocks)).toBe(true);

    const annotations = await fetch(base + "/api/files/" + key + "/annotations");
    expect(annotations.status).toBe(200);

    const reviewed = await fetch(base + "/api/reviewed-files");
    expect(reviewed.status).toBe(200);

    const sessionFiles = await fetch(base + "/api/session-files");
    expect(sessionFiles.status).toBe(200);

    const ping = await fetch(base + "/api/ping");
    expect(ping.status).toBe(200);
  });
});
```

### 4. Link detection edge-case tests

Add tests for the route table and link detection behavior:

```ts
describe("detectMdLinks", () => {
  it("marks current-file-relative markdown links only", async () => {
    // Fixture:
    // entry.md links nested/one.md
    // nested/one.md links ./two.md
    // Expect ./two.md to resolve to nested/two.md, not two.md at session root.
  });

  it("rejects schemes, absolute paths, query strings, and missing files", async () => {
    // http://x/y.md, mailto:a@b, /tmp/a.md, ./missing.md, ./file.md?download=1 are not navigational.
  });

  it("allows hash fragments and case-insensitive .MD extensions", async () => {
    // ./Guide.MD#section resolves to Guide.MD and preserves originalUrl.
  });
});
```

## Acceptance criteria

- [ ] `AGENTS.md` updated with multi-file section
- [ ] `README.md` updated (if exists)
- [ ] Integration route/link tests pass: `bun test test/integration-routes.ts`
- [ ] `bun run typecheck` passes
- [ ] Full test suite passes: `bun test`

## Files to modify

- `AGENTS.md` — add multi-file section
- `README.md` — update usage (if exists)
- `test/integration-routes.ts` — **new file**
