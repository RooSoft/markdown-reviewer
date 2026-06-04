import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir, readdir, realpath } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "./index";
import { FileStore } from "./file-store";
import { detectMdLinks } from "./markdown-service";
import {
  writeSessionMarkers,
  saveSessionManifest,
  readSessionMarker,
  generateShortId,
  type SessionManifest,
} from "./session-manifest";

// ---------------------------------------------------------------------------
// Multi-file route surface
// ---------------------------------------------------------------------------

describe("multi-file route surface", () => {
  let dir: string;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdr-multi-file-"));
    await writeFile(
      join(dir, "entry.md"),
      "# Entry\n\n[Next](./nested/next.md)\n",
      "utf-8"
    );
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested/next.md"), "# Next\n", "utf-8");
  });

  afterEach(async () => {
    if (running) await running.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("exports required multi-file primitives", () => {
    expect(FileStore).toBeDefined();
    expect(typeof detectMdLinks).toBe("function");
  });

  test("serves required multi-file routes", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
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

    // Backward compat routes
    expect((await fetch(base + "/api/markdown")).status).toBe(200);
    expect((await fetch(base + "/api/annotations")).status).toBe(200);
    expect((await fetch(base + "/api/done", { method: "POST" })).status).toBe(200);
  });

  test("GET /api/files returns files array and activeKey", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const data = await (await fetch(running.url + "/api/files")).json();
    expect(Array.isArray(data.files)).toBe(true);
    expect(typeof data.activeKey).toBe("string");
    expect(data.files.length).toBe(1);
    expect(data.files[0].key).toBeDefined();
    expect(data.files[0].fileName).toBeDefined();
    expect(typeof data.files[0].annotationCount).toBe("number");
  });

  test("GET /api/files/:key returns full file data", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const key = encodeURIComponent("nested/next.md");
    const data = await (await fetch(running.url + "/api/files/" + key)).json();
    expect(typeof data.source).toBe("string");
    expect(Array.isArray(data.blocks)).toBe(true);
    expect(typeof data.fullHtml).toBe("string");
    expect(Array.isArray(data.links)).toBe(true);
    expect(typeof data.fileName).toBe("string");
    expect(typeof data.key).toBe("string");
  });

  test("GET /api/files/:key/annotations returns annotations array", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const key = encodeURIComponent("nested/next.md");
    // Load the file first
    await fetch(running.url + "/api/files/" + key);
    const data = await (
      await fetch(running.url + "/api/files/" + key + "/annotations")
    ).json();
    expect(Array.isArray(data.annotations)).toBe(true);
  });

  test("POST /api/files/:key/annotations creates annotation", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const key = encodeURIComponent("nested/next.md");
    // Load the file first
    const fileData = await (await fetch(running.url + "/api/files/" + key)).json();
    const heading = fileData.blocks.find((b: any) => b.type === "heading");
    expect(heading).toBeDefined();

    const res = await fetch(running.url + "/api/files/" + key + "/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anchor: heading.anchor,
        blockType: heading.type,
        blockText: heading.text,
        blockLineRange: heading.lineRange,
        comment: "Test annotation",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.annotation.id).toBeDefined();
    expect(data.annotation.comment).toBe("Test annotation");
  });

  test("DELETE /api/files/:key/annotations/:id removes annotation", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const key = encodeURIComponent("nested/next.md");
    // Load the file and create an annotation
    const fileData = await (await fetch(running.url + "/api/files/" + key)).json();
    const heading = fileData.blocks.find((b: any) => b.type === "heading");

    const createRes = await fetch(running.url + "/api/files/" + key + "/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anchor: heading.anchor,
        blockType: heading.type,
        blockText: heading.text,
        blockLineRange: heading.lineRange,
        comment: "To delete",
      }),
    });
    const createData = await createRes.json();
    const id = createData.annotation.id;

    // Delete it
    const delRes = await fetch(
      running.url + "/api/files/" + key + "/annotations/" + encodeURIComponent(id),
      { method: "DELETE" }
    );
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.ok).toBe(true);

    // Verify gone
    const listRes = await fetch(running.url + "/api/files/" + key + "/annotations");
    const listData = await listRes.json();
    expect(listData.annotations.length).toBe(0);
  });

  test("GET /api/session-files returns session file list", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const data = await (await fetch(running.url + "/api/session-files")).json();
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files.length).toBe(1);
    expect(data.files[0].isEntry).toBe(true);
  });

  test("GET /api/reviewed-files returns files with annotations", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    // Initially empty
    const data1 = await (await fetch(running.url + "/api/reviewed-files")).json();
    expect(data1.files.length).toBe(0);

    // Add annotation to entry file
    const mdData = await (await fetch(running.url + "/api/markdown")).json();
    const heading = mdData.blocks.find((b: any) => b.type === "heading");
    await fetch(running.url + "/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anchor: heading.anchor,
        blockType: heading.type,
        blockText: heading.text,
        blockLineRange: heading.lineRange,
        comment: "Review",
      }),
    });

    const data2 = await (await fetch(running.url + "/api/reviewed-files")).json();
    expect(data2.files.length).toBe(1);
    expect(data2.files[0].reviewedPath).toContain(".mdr");
    expect(data2.files[0].sourcePath).toContain("entry.md");
    expect(data2.files[0].annotationCount).toBe(1);
  });

  test("GET /api/ping returns { ok: true }", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const data = await (await fetch(running.url + "/api/ping")).json();
    expect(data.ok).toBe(true);
  });

  test("backward compat: GET /api/markdown returns entry file data", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const data = await (await fetch(running.url + "/api/markdown")).json();
    expect(data.source).toContain("# Entry");
    expect(Array.isArray(data.blocks)).toBe(true);
  });

  test("backward compat: GET /api/annotations returns entry file annotations", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const data = await (await fetch(running.url + "/api/annotations")).json();
    expect(Array.isArray(data.annotations)).toBe(true);
  });

  test("backward compat: POST /api/done writes .mdr and stays alive", async () => {
    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
    });
    const res = await fetch(running.url + "/api/done", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.path).toBe("string");
    expect(data.path).toContain(".mdr");

    // Server still alive
    const alive = await fetch(running.url + "/api/markdown");
    expect(alive.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// detectMdLinks — integration-level edge cases
// ---------------------------------------------------------------------------

describe("detectMdLinks — integration edge cases", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), "mdr-link-test-"));
    await writeFile(join(testRoot, "root.md"), "# Root\n\nContent", "utf-8");
    await writeFile(join(testRoot, "target.md"), "# Target\n\nContent", "utf-8");
    await writeFile(join(testRoot, "uppercase.MD"), "# Uppercase", "utf-8");
    await writeFile(join(testRoot, "review.mdr"), "review output", "utf-8");
    await mkdir(join(testRoot, "nested"), { recursive: true });
    await writeFile(
      join(testRoot, "nested", "inner.md"),
      "# Inner\n\n[back](../target.md)",
      "utf-8"
    );
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  test("current-file-relative resolution: nested/inner.md → ../target.md resolves to target.md", async () => {
    const source = "[back](../target.md)";
    const links = await detectMdLinks(source, {
      currentFileDir: join(testRoot, "nested"),
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(1);
    expect(links[0].resolvedKey).toBe("target.md");
  });

  test("nested file resolves sibling link correctly", async () => {
    const source = "[sibling](../root.md)";
    const links = await detectMdLinks(source, {
      currentFileDir: join(testRoot, "nested"),
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(1);
    expect(links[0].resolvedKey).toBe("root.md");
  });

  test("rejects http scheme", async () => {
    const source = "[http](http://example.com/page.md)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(0);
  });

  test("rejects mailto scheme", async () => {
    const source = "[mailto](mailto:user@example.com)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(0);
  });

  test("rejects absolute paths", async () => {
    const source = "[abs](/tmp/some-file.md)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(0);
  });

  test("rejects query strings", async () => {
    const source = "[query](target.md?download=1)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(0);
  });

  test("rejects .mdr files", async () => {
    const source = "[review](review.mdr)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(0);
  });

  test("rejects missing files", async () => {
    const source = "[missing](does-not-exist.md)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(0);
  });

  test("allows hash fragments", async () => {
    const source = "[anchor](target.md#heading)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(1);
    expect(links[0].originalUrl).toBe("target.md#heading");
    expect(links[0].resolvedKey).toBe("target.md");
  });

  test("allows case-insensitive .MD extension", async () => {
    const source = "[upper](uppercase.MD)";
    const links = await detectMdLinks(source, {
      currentFileDir: testRoot,
      sessionRoot: testRoot,
    });
    expect(links).toHaveLength(1);
    expect(links[0].originalUrl).toBe("uppercase.MD");
    expect(links[0].resolvedKey).toBe("uppercase.MD");
  });
});

// ---------------------------------------------------------------------------
// Session merge — older survives, younger deleted
// ---------------------------------------------------------------------------

describe("session merge — older survives, younger deleted", () => {
  let dir: string;
  let tmpDir: string;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdr-merge-"));
    tmpDir = join(dir, ".tmp");

    // Create 6 files: A, B, C (older session) and D, E, F (younger session)
    // Make D link to A so that loading D and clicking A triggers a merge
    await writeFile(join(dir, "A.md"), "# A\n\nContent A", "utf-8");
    await writeFile(join(dir, "B.md"), "# B\n\nContent B", "utf-8");
    await writeFile(join(dir, "C.md"), "# C\n\nContent C", "utf-8");
    await writeFile(join(dir, "D.md"), "# D\n\n[Link to A](A.md)", "utf-8");
    await writeFile(join(dir, "E.md"), "# E\n\nContent E", "utf-8");
    await writeFile(join(dir, "F.md"), "# F\n\nContent F", "utf-8");
  });

  afterEach(async () => {
    if (running) await running.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("merges {A,B,C} and {D,E,F} into the older session when D-run links to A", async () => {
    // --- Step 1: Create older session {A, B, C} ---
    const olderId = generateShortId();
    const olderCreatedAt = Date.now() - 10_000; // 10 seconds ago
    const realDir = await realpath(dir);

    const olderManifest: SessionManifest = {
      id: olderId,
      createdAt: olderCreatedAt,
      sessionRoot: realDir,
      entryFilePath: join(realDir, "A.md"),
      files: [
        { filePath: join(realDir, "A.md"), firstLoadedAt: olderCreatedAt, lastLoadedAt: olderCreatedAt },
        { filePath: join(realDir, "B.md"), firstLoadedAt: olderCreatedAt, lastLoadedAt: olderCreatedAt },
        { filePath: join(realDir, "C.md"), firstLoadedAt: olderCreatedAt, lastLoadedAt: olderCreatedAt },
      ],
      updatedAt: olderCreatedAt,
    };
    await saveSessionManifest(olderManifest, tmpDir);

    // Write session markers for A, B, C pointing to older session
    for (const f of ["A.md", "B.md", "C.md"]) {
      await writeSessionMarkers(join(realDir, f), tmpDir, olderId);
    }

    // --- Step 2: Start fresh server with D (younger session) ---
    running = await startServer({
      filePath: join(dir, "D.md"),
      tmpDir,
      port: 0,
      fresh: true,
    });

    // The fresh server should have created a new manifest for D
    // --- Step 3: Add E and F to the younger session by loading them ---
    const keyE = encodeURIComponent("E.md");
    const keyF = encodeURIComponent("F.md");
    await fetch(running.url + "/api/files/" + keyE);
    await fetch(running.url + "/api/files/" + keyF);

    // Verify younger session has D, E, F
    const sessionFilesBefore = await (
      await fetch(running.url + "/api/session-files")
    ).json();
    expect(sessionFilesBefore.files.length).toBe(3);

    // --- Step 4: Load A via GET /api/files/A.md — this triggers merge ---
    const keyA = encodeURIComponent("A.md");
    await fetch(running.url + "/api/files/" + keyA);

    // --- Step 5: Assert merge results ---

    // Check that only one manifest remains (the older one)
    const sessionsDir = join(tmpDir, "sessions");
    const manifests = await readdir(sessionsDir);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toBe(olderId + ".json");

    // Check session-files returns all 6 files
    const sessionFilesAfter = await (
      await fetch(running.url + "/api/session-files")
    ).json();
    const fileKeys = sessionFilesAfter.files.map((f: any) => f.key).sort();
    expect(fileKeys).toContain("A.md");
    expect(fileKeys).toContain("B.md");
    expect(fileKeys).toContain("C.md");
    expect(fileKeys).toContain("D.md");
    expect(fileKeys).toContain("E.md");
    expect(fileKeys).toContain("F.md");
    expect(sessionFilesAfter.files.length).toBe(6);

    // Check all .session markers point to the survivor (older id)
    for (const f of ["A.md", "B.md", "C.md", "D.md", "E.md", "F.md"]) {
      const marker = await readSessionMarker(join(realDir, f), tmpDir);
      expect(marker).toBe(olderId);
    }
  });
});

// ---------------------------------------------------------------------------
// --auto-discover tests
// ---------------------------------------------------------------------------

describe("--auto-discover", () => {
  let dir: string;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdr-autodiscover-"));
  });

  afterEach(async () => {
    if (running) await running.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("registers the whole reachable .md graph without clicking, cycle-safe", async () => {
    // entry → a.md → b.md → entry (cycle)
    await writeFile(
      join(dir, "entry.md"),
      "# Entry\n\n[Go to A](a.md)",
      "utf-8"
    );
    await writeFile(
      join(dir, "a.md"),
      "# A\n\n[Go to B](b.md)",
      "utf-8"
    );
    await writeFile(
      join(dir, "b.md"),
      "# B\n\n[Back to entry](entry.md)",
      "utf-8"
    );

    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
      autoDiscover: true,
    });

    // Wait for discovery to complete
    let discovered = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const data = await (await fetch(running.url + "/api/session-files")).json();
      if (data.discovering === false) {
        discovered = true;
        break;
      }
    }
    expect(discovered).toBe(true);

    // All 3 files should be in the session
    const data = await (await fetch(running.url + "/api/session-files")).json();
    const keys = data.files.map((f: any) => f.key).sort();
    // Keys may be realpath-normalized on macOS (/tmp → /private/var/...)
    // so check by basename
    const basenames = keys.map((k: string) => k.split("/").pop()).sort();
    expect(basenames).toContain("entry.md");
    expect(basenames).toContain("a.md");
    expect(basenames).toContain("b.md");
    expect(data.files.length).toBe(3);
  });

  test("does not discover .mdr / scheme / absolute / query-string targets", async () => {
    await writeFile(
      join(dir, "entry.md"),
      "# Entry\n\n[mdr](review.mdr) [http](http://x/y.md) [abs](/tmp/a.md) [query](target.md?q=1)\n[valid](valid.md)",
      "utf-8"
    );
    await writeFile(join(dir, "review.mdr"), "review", "utf-8");
    await writeFile(join(dir, "valid.md"), "# Valid", "utf-8");

    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
      autoDiscover: true,
    });

    // Wait for discovery
    let discovered = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const data = await (await fetch(running.url + "/api/session-files")).json();
      if (data.discovering === false) {
        discovered = true;
        break;
      }
    }
    expect(discovered).toBe(true);

    const data = await (await fetch(running.url + "/api/session-files")).json();
    const basenames = data.files.map((f: any) => f.key.split("/").pop()).sort();
    // Only entry.md and valid.md should be discovered
    expect(basenames).toContain("entry.md");
    expect(basenames).toContain("valid.md");
    expect(basenames).not.toContain("review.mdr");
    expect(data.files.length).toBe(2);
  });

  test("is off by default — only the entry file is in the session at startup", async () => {
    await writeFile(
      join(dir, "entry.md"),
      "# Entry\n\n[Go to B](b.md)",
      "utf-8"
    );
    await writeFile(join(dir, "b.md"), "# B", "utf-8");

    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
      // autoDiscover not set (defaults to false)
    });

    // Give it a moment, then check — should only have entry file
    await new Promise((r) => setTimeout(r, 500));
    const data = await (await fetch(running.url + "/api/session-files")).json();
    expect(data.files.length).toBe(1);
    expect(data.files[0].key).toBe("entry.md");
  });

  // R2: B5 race test — concurrent auto-discover crawl + on-demand file load
  // verifies the manifest mutex prevents lost updates
  test("B5: concurrent crawl + on-demand load does not lose manifest entries", async () => {
    // Create entry with links to multiple files (triggers crawl)
    await writeFile(
      join(dir, "entry.md"),
      "# Entry\n\n[A](a.md) [B](b.md) [C](c.md) [D](d.md) [E](e.md)",
      "utf-8"
    );
    for (const name of ["a.md", "b.md", "c.md", "d.md", "e.md"]) {
      await writeFile(join(dir, name), `# ${name.replace(".md", "")}\n\nContent.`, "utf-8");
    }

    running = await startServer({
      filePath: join(dir, "entry.md"),
      tmpDir: join(dir, ".tmp"),
      port: 0,
      autoDiscover: true,
      graceTimeout: 60000,      // long grace so heartbeat doesn't interfere
    });

    // Keep server alive with periodic pings
    const pingInterval = setInterval(() => {
      fetch(running!.url + "/api/ping").catch(() => {});
    }, 2000);

    try {
      // Immediately start loading files on-demand while crawl is running
      // This exercises the B5 race condition (crawl vs request handlers)
      const loadPromises = ["a.md", "b.md", "c.md", "d.md", "e.md"].map(async (key) => {
        // Small delay to interleave with crawl
        await new Promise((r) => setTimeout(r, Math.random() * 30));
        const res = await fetch(running!.url + "/api/files/" + encodeURIComponent(key));
        expect(res.status).toBe(200);
        return res.json();
      });

      // Wait for all loads to complete
      const results = await Promise.all(loadPromises);
      expect(results.length).toBe(5);

      // Wait for crawl to finish
      let discovered = false;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const data = await (await fetch(running!.url + "/api/session-files")).json();
        if (data.discovering === false) {
          discovered = true;
          break;
        }
      }
      expect(discovered).toBe(true);

      // Final check: all files should be in the session
      const finalData = await (await fetch(running!.url + "/api/session-files")).json();
      const keys = finalData.files.map((f: any) => f.key).sort();
      expect(keys).toContain("entry.md");
      expect(keys).toContain("a.md");
      expect(keys).toContain("b.md");
      expect(keys).toContain("c.md");
      expect(keys).toContain("d.md");
      expect(keys).toContain("e.md");
      expect(finalData.files.length).toBe(6);
    } finally {
      clearInterval(pingInterval);
    }
  }, 30000);
});
