import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "./index";
import { SessionLockedError } from "./annotation-service";
import type { RunningServer } from "./index";

describe("HTTP server & API routes", () => {
  let tmpDir: string;
  let mdPath: string;
  let server: RunningServer | null = null;

  const sampleMd = `# Hello

A paragraph.

- Item 1
- Item 2

\`\`\`js
const x = 1;
\`\`\`
`;

  async function cleanup() {
    if (server) {
      try {
        await server.stop();
      } catch {
        // Server may already be stopped
      }
      server = null;
    }
    if (tmpDir) {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  beforeEach(async () => {
    tmpDir = join("/tmp", `mdr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    mdPath = join(tmpDir, "test.md");
    await writeFile(mdPath, sampleMd, "utf-8");
  });

  afterEach(async () => {
    await cleanup();
  });

  test("GET /api/markdown returns { source, blocks } with proper shapes", async () => {
    server = await startServer({ filePath: mdPath, tmpDir, port: 0 });
    const res = await fetch(`${server.url}/api/markdown`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.source).toBe(sampleMd);
    expect(Array.isArray(data.blocks)).toBe(true);
    expect(data.blocks.length).toBeGreaterThan(0);

    const block = data.blocks[0];
    expect(block.id).toBeDefined();
    expect(block.anchor).toBeDefined();
    expect(typeof block.anchor.siblingOrdinal).toBe("number");
    expect(block.type).toBeDefined();
    expect(block.text).toBeDefined();
    expect(block.html).toBeDefined();
  });

  test("GET /api/annotations returns { annotations }", async () => {
    server = await startServer({ filePath: mdPath, tmpDir, port: 0 });
    const res = await fetch(`${server.url}/api/annotations`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.annotations)).toBe(true);
    expect(data.annotations.length).toBe(0);
  });

  test("POST /api/annotations creates, then DELETE removes", async () => {
    server = await startServer({ filePath: mdPath, tmpDir, port: 0 });

    // Fetch blocks to get a real anchor
    const mdRes = await fetch(`${server.url}/api/markdown`);
    const mdData = await mdRes.json();
    const headingBlock = mdData.blocks.find((b: any) => b.type === "heading");
    expect(headingBlock).toBeDefined();

    // Create annotation with a real anchor
    const createRes = await fetch(`${server.url}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anchor: headingBlock.anchor,
        blockType: headingBlock.type,
        blockText: headingBlock.text,
        blockLineRange: headingBlock.lineRange,
        comment: "Test comment",
      }),
    });
    expect(createRes.status).toBe(201);

    const createData = await createRes.json();
    expect(createData.annotation).toBeDefined();
    expect(createData.annotation.id).toBeDefined();
    expect(createData.annotation.comment).toBe("Test comment");
    const id = createData.annotation.id;

    // Verify it shows up in GET
    const listRes = await fetch(`${server.url}/api/annotations`);
    const listData = await listRes.json();
    expect(listData.annotations.length).toBe(1);
    expect(listData.annotations[0].status).toBeDefined();

    // Delete annotation
    const deleteRes = await fetch(`${server.url}/api/annotations/${id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    const deleteData = await deleteRes.json();
    expect(deleteData.ok).toBe(true);

    // Verify it's gone
    const listRes2 = await fetch(`${server.url}/api/annotations`);
    const listData2 = await listRes2.json();
    expect(listData2.annotations.length).toBe(0);
  });

  test("DELETE of missing id returns 404", async () => {
    server = await startServer({ filePath: mdPath, tmpDir, port: 0 });

    const res = await fetch(`${server.url}/api/annotations/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("forced-failure POST /api/done returns error body, server stays up", async () => {
    // Create a source file in a read-only directory to force writeReview failure
    const failDir = join(tmpDir, "readonly");
    await mkdir(failDir, { recursive: true });
    const failMdPath = join(failDir, "fail.md");
    await writeFile(failMdPath, "# Fail test\n\nContent.", "utf-8");

    // Make directory read-only so writeReview can't create _reviewed.md
    await chmod(failDir, 0o555);

    server = await startServer({ filePath: failMdPath, tmpDir, port: 0 });

    // POST /api/done should fail
    const res = await fetch(`${server.url}/api/done`, { method: "POST" });
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(typeof data.error).toBe("string");

    // Server should still be running
    const stillAlive = await fetch(`${server.url}/api/markdown`);
    expect(stillAlive.status).toBe(200);

    // Restore permissions for cleanup
    await chmod(failDir, 0o755);
  });

  test("success POST /api/done writes file, server stops", async () => {
    // Use a fresh tmp dir for this test to avoid stale session data
    const freshDir = join("/tmp", `mdr-done-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(freshDir, { recursive: true });
    const doneMdPath = join(freshDir, "done.md");
    await writeFile(doneMdPath, "# Done test\n\nSome content.", "utf-8");

    server = await startServer({ filePath: doneMdPath, tmpDir: freshDir, port: 0 });

    // Fetch blocks to get a real anchor
    const doneMdRes = await fetch(`${server.url}/api/markdown`);
    const doneMdData = await doneMdRes.json();
    const doneHeadingBlock = doneMdData.blocks.find((b: any) => b.type === "heading");
    expect(doneHeadingBlock).toBeDefined();

    // Add an annotation with a real anchor
    const createRes = await fetch(`${server.url}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anchor: doneHeadingBlock.anchor,
        blockType: doneHeadingBlock.type,
        blockText: doneHeadingBlock.text,
        blockLineRange: doneHeadingBlock.lineRange,
        comment: "Final comment",
      }),
    });
    expect(createRes.status).toBe(201);

    // POST /api/done — should succeed
    const doneRes = await fetch(`${server.url}/api/done`, { method: "POST" });
    expect(doneRes.status).toBe(200);

    const doneData = await doneRes.json();
    expect(doneData.ok).toBe(true);
    expect(typeof doneData.path).toBe("string");
    expect(doneData.path).toContain("_reviewed.md");

    // Verify the file was written
    const content = await readFile(doneData.path, "utf-8");
    expect(content).toContain("Review of done.md");
    expect(content).toContain("Final comment");

    // Mark server as stopped (it will stop via queueMicrotask)
    const serverUrl = server.url;
    server = null;

    // Give the server time to shut down
    await new Promise((r) => setTimeout(r, 500));

    // Server should be stopped — follow-up fetch should reject
    await expect(fetch(`${serverUrl}/api/markdown`)).rejects.toThrow();

    // Cleanup
    try {
      await rm(freshDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("session lock: second server on same file throws locked error", async () => {
    server = await startServer({ filePath: mdPath, tmpDir, port: 0 });

    // Try to start a second server on the same file
    await expect(
      startServer({ filePath: mdPath, tmpDir, port: 0 })
    ).rejects.toThrow(SessionLockedError);
  });

  test("GET / injects file name into data-file-name attribute", async () => {
    // Use a file with a distinctive name
    const namedPath = join(tmpDir, "my-proposal.md");
    await writeFile(namedPath, sampleMd, "utf-8");

    server = await startServer({ filePath: namedPath, tmpDir, port: 0 });

    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('data-file-name="my-proposal.md"');
  });
});
