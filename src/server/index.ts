import { join, basename as pathBasename, extname, dirname, relative, resolve as resolvePath } from "node:path";
import { readFile, access, stat, realpath } from "node:fs/promises";
import { loadDocument } from "./markdown-service";
import { relocate } from "./anchoring";
import { openSession, SessionLockedError, type Session } from "./annotation-service";
import { writeReview } from "../review/generator";
import { FileStore, type FileEntry } from "./file-store";
import type { BlockNode, Annotation, FileKey } from "../shared/types";

// Re-export for consumers
export { SessionLockedError } from "./annotation-service";

// ---------------------------------------------------------------------------
// MIME types for static assets
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerOptions {
  filePath: string;       // the markdown file being reviewed (absolute or cwd-relative)
  port?: number;          // if omitted, auto-select a free port (port 0 → OS assigns)
  tmpDir: string;         // annotation storage root
  fresh?: boolean;        // pass through to openSession
}

export interface RunningServer {
  url: string;
  port: number;
  stop(): Promise<void>;
  /** Resolves when the server has stopped (either via stop() or self-shutdown). */
  stopped: Promise<void>;
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

let _pageHtml: string | null = null;
let _appJs: string | null = null;

async function loadPageHtml(): Promise<string> {
  if (!_pageHtml) {
    _pageHtml = await readFile(
      join(import.meta.dir, "..", "frontend", "page.html"),
      "utf-8"
    );
  }
  return _pageHtml;
}

async function loadAppJs(): Promise<string> {
  if (!_appJs) {
    _appJs = await readFile(
      join(import.meta.dir, "..", "frontend", "app.js"),
      "utf-8"
    );
  }
  return _appJs;
}

// ---------------------------------------------------------------------------
// Per-file regeneration helper
// ---------------------------------------------------------------------------

async function regenerateReviewedFile(entry: FileEntry): Promise<void> {
  const annotations = await entry.session.list();
  const relocated = relocate(annotations, entry.blocks);
  await writeReview(entry.filePath, entry.source, relocated);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { filePath, port = 0, tmpDir, fresh } = opts;

  // Resolve entry file to absolute path
  const entryFilePath = resolvePath(filePath);
  const sessionRoot = dirname(entryFilePath);

  // Load and parse document
  const { source, fileHash, blocks, fullHtml } = await loadDocument(entryFilePath);

  // Open annotation session for entry file
  const entrySession = await openSession(entryFilePath, { tmpDir, fresh });

  // Create FileStore with entry file
  const entryKey = relative(sessionRoot, entryFilePath) as FileKey;
  const fileStore = new FileStore(sessionRoot, entryKey);

  const entryFileEntry: FileEntry = {
    key: entryKey,
    filePath: entryFilePath,
    source,
    fileHash,
    blocks,
    fullHtml,
    links: [],
    fileName: pathBasename(entryFilePath),
    annotationCount: 0,
    session: entrySession,
  };
  fileStore.add(entryFileEntry);

  // Read templates
  const pageHtml = await loadPageHtml();
  const appJs = await loadAppJs();

  // Inject full-document HTML and file name
  const fileName = entryFileEntry.fileName;
  const renderedPage = pageHtml
    .replace("<!--BLOCKS-->", fullHtml)
    .replace("<!--FILE_NAME-->", fileName)
    .replace("<!--FILE_KEY-->", entryKey);

  // Stopped promise — resolves when the server shuts down (via stop() or self-shutdown)
  let resolveStopped: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });

  // Start the HTTP server (bind to localhost only — not LAN-exposed)
  const bunServer = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // GET / — prerendered page
      if (pathname === "/" && req.method === "GET") {
        return new Response(renderedPage, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // GET /app.js — inline JS
      if (pathname === "/app.js" && req.method === "GET") {
        return new Response(appJs, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      // GET /static/* — static assets from public/
      if (pathname.startsWith("/static/") && req.method === "GET") {
        const relPath = pathname.slice("/static/".length);
        const publicDir = join(import.meta.dir, "..", "..", "public");
        const assetPath = join(publicDir, relPath);
        // Containment: ensure resolved path is inside public/
        if (!assetPath.startsWith(publicDir)) {
          return json({ ok: false, error: `Not found: ${pathname}` }, 404);
        }
        try {
          await access(assetPath);
          const ext = extname(assetPath).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
          const data = await readFile(assetPath);
          return new Response(data, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        } catch {
          return json({ ok: false, error: `Not found: ${pathname}` }, 404);
        }
      }

      // GET /api/files — list loaded files + activeKey
      if (pathname === "/api/files" && req.method === "GET") {
        const files = fileStore.list().map((entry) => ({
          key: entry.key,
          fileName: entry.fileName,
          annotationCount: entry.annotationCount,
        }));
        return json({ files, activeKey: fileStore.getEntryKey() });
      }

      // GET /api/files/:key — load file on-demand
      if (pathname.match(/^\/api\/files\/[^/]+$/) && req.method === "GET") {
        const encodedKey = pathname.replace("/api/files/", "");
        if (!encodedKey) {
          return json({ ok: false, error: "Missing file key" }, 400);
        }

        let key: string;
        try {
          key = decodeURIComponent(encodedKey);
        } catch {
          return json({ ok: false, error: "Malformed file key" }, 400);
        }

        // Return cached data if already loaded
        const cached = fileStore.get(key as FileKey);
        if (cached) {
          // Refresh annotation count
          const annotations = await cached.session.list();
          cached.annotationCount = annotations.length;

          return json({
            source: cached.source,
            blocks: cached.blocks,
            fullHtml: cached.fullHtml,
            links: cached.links,
            fileName: cached.fileName,
            key: cached.key,
            annotationCount: cached.annotationCount,
          });
        }

        // Resolve key relative to session root
        const resolvedPath = resolvePath(fileStore.getSessionRoot(), key);

        // Validate: must be an existing regular .md file
        try {
          const realPath = await realpath(resolvedPath);
          const fileStat = await stat(realPath);

          if (!fileStat.isFile()) {
            return json({ ok: false, error: `Not a regular file: ${key}` }, 404);
          }

          if (!realPath.toLowerCase().endsWith(".md")) {
            return json({ ok: false, error: `Not a .md file: ${key}` }, 404);
          }

          // Acquire per-file lock
          let session: Session;
          try {
            session = await openSession(realPath, { tmpDir });
          } catch (err: any) {
            if (err instanceof SessionLockedError) {
              return json(
                { ok: false, error: `File is locked by another session: ${key}` },
                409
              );
            }
            throw err;
          }

          // Parse the document with link detection
          const doc = await loadDocument(realPath, {
            sessionRoot: fileStore.getSessionRoot(),
            currentFileDir: dirname(realPath),
          });

          // Add to FileStore
          const newEntry: FileEntry = {
            key: key as FileKey,
            filePath: realPath,
            source: doc.source,
            fileHash: doc.fileHash,
            blocks: doc.blocks,
            fullHtml: doc.fullHtml,
            links: doc.links,
            fileName: pathBasename(realPath),
            annotationCount: 0,
            session,
          };
          fileStore.add(newEntry);

          return json({
            source: newEntry.source,
            blocks: newEntry.blocks,
            fullHtml: newEntry.fullHtml,
            links: newEntry.links,
            fileName: newEntry.fileName,
            key: newEntry.key,
            annotationCount: newEntry.annotationCount,
          });
        } catch (err: any) {
          if (err.code === "ENOENT") {
            return json({ ok: false, error: `File not found: ${key}` }, 404);
          }
          if (err instanceof SessionLockedError) {
            return json(
              { ok: false, error: `File is locked by another session: ${key}` },
              409
            );
          }
          return json(
            { ok: false, error: err.message ?? "Failed to load file" },
            500
          );
        }
      }

      // GET /api/files/:key/annotations — file-scoped annotations
      if (pathname.match(/^\/api\/files\/[^/]+\/annotations$/) && req.method === "GET") {
        const encodedKey = pathname.replace("/api/files/", "").replace("/annotations", "");
        if (!encodedKey) {
          return json({ ok: false, error: "Missing file key" }, 400);
        }

        let key: string;
        try {
          key = decodeURIComponent(encodedKey);
        } catch {
          return json({ ok: false, error: "Malformed file key" }, 400);
        }

        const entry = fileStore.get(key as FileKey);
        if (!entry) {
          return json({ ok: false, error: `File not loaded: ${key}` }, 404);
        }

        const annotations = await entry.session.list();
        const relocated = relocate(annotations, entry.blocks);

        // Persist status changes
        for (const r of relocated) {
          const original = annotations.find((a) => a.id === r.annotation.id);
          if (original) {
            const statusChanged = original.status !== r.annotation.status;
            const ordinalChanged = original.anchor.siblingOrdinal !== r.annotation.anchor.siblingOrdinal;
            if (statusChanged || ordinalChanged) {
              await entry.session.save(r.annotation);
            }
          }
        }

        entry.annotationCount = relocated.length;
        return json({ annotations });
      }

      // POST /api/files/:key/annotations — create/update annotation scoped to file
      if (pathname.match(/^\/api\/files\/[^/]+\/annotations$/) && req.method === "POST") {
        const encodedKey = pathname.replace("/api/files/", "").replace("/annotations", "");
        if (!encodedKey) {
          return json({ ok: false, error: "Missing file key" }, 400);
        }

        let key: string;
        try {
          key = decodeURIComponent(encodedKey);
        } catch {
          return json({ ok: false, error: "Malformed file key" }, 400);
        }

        const entry = fileStore.get(key as FileKey);
        if (!entry) {
          return json({ ok: false, error: `File not loaded: ${key}` }, 404);
        }

        const body = await req.json();
        const { anchor, blockType, blockText, blockLineRange, comment, id } = body;

        if (!anchor || !blockType || !comment) {
          return json(
            { ok: false, error: "Missing required fields: anchor, blockType, comment" },
            400
          );
        }

        // Validate anchor matches a current block (tier-1 or tier-2)
        const anchorStr = `${anchor.blockType}:${anchor.textHash}:${anchor.siblingOrdinal}`;
        const contentKey = `${anchor.blockType}:${anchor.textHash}`;
        const matchesExact = entry.blocks.some(
          (b) => `${b.anchor.blockType}:${b.anchor.textHash}:${b.anchor.siblingOrdinal}` === anchorStr
        );
        const matchesContent = entry.blocks.some(
          (b) => `${b.anchor.blockType}:${b.anchor.textHash}` === contentKey
        );
        if (!matchesExact && !matchesContent) {
          return json(
            { ok: false, error: "Anchor does not match any current block" },
            400
          );
        }

        const now = Date.now();
        const annotation: Annotation = {
          id: id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 8),
          anchor,
          blockType,
          blockText: blockText ?? "",
          blockLineRange: blockLineRange ?? [0, 0],
          comment,
          status: "ok",
          createdAt: now,
          updatedAt: now,
        };

        const saved = await entry.session.save(annotation);
        const relocated = relocate([saved], entry.blocks);
        const resolved = relocated[0]?.annotation;

        if (resolved) {
          await entry.session.save(resolved);
          entry.annotationCount = (await entry.session.list()).length;
          await regenerateReviewedFile(entry);
          return json({ annotation: resolved }, id ? 200 : 201);
        }

        entry.annotationCount = (await entry.session.list()).length;
        await regenerateReviewedFile(entry);
        return json({ annotation: saved }, id ? 200 : 201);
      }

      // DELETE /api/files/:key/annotations/:id
      if (pathname.match(/^\/api\/files\/[^/]+\/annotations\/[^/]+$/) && req.method === "DELETE") {
        const match = pathname.match(/^\/api\/files\/([^/]+)\/annotations\/([^/]+)$/);
        if (!match) {
          return json({ ok: false, error: "Invalid path" }, 400);
        }

        const encodedKey = match[1]!;
        const id = match[2]!;

        let key: string;
        try {
          key = decodeURIComponent(encodedKey);
        } catch {
          return json({ ok: false, error: "Malformed file key" }, 400);
        }

        const entry = fileStore.get(key as FileKey);
        if (!entry) {
          return json({ ok: false, error: `File not loaded: ${key}` }, 404);
        }

        // Check existence BEFORE removing
        const annotations = await entry.session.list();
        const exists = annotations.some((a) => a.id === id);
        if (!exists) {
          return json({ ok: false, error: `Annotation ${id} not found` }, 404);
        }

        await entry.session.remove(id);
        entry.annotationCount = (await entry.session.list()).length;
        await regenerateReviewedFile(entry);
        return json({ ok: true });
      }

      // --- Backward-compatible routes (delegate to entry file) ---

      // GET /api/markdown → entry file
      if (pathname === "/api/markdown" && req.method === "GET") {
        const entry = fileStore.get(fileStore.getEntryKey());
        if (!entry) {
          return json({ ok: false, error: "Entry file not found" }, 500);
        }
        return json({ source: entry.source, blocks: entry.blocks });
      }

      // GET /api/annotations → entry file
      if (pathname === "/api/annotations" && req.method === "GET") {
        const entry = fileStore.get(fileStore.getEntryKey());
        if (!entry) {
          return json({ ok: false, error: "Entry file not found" }, 500);
        }

        const annotations = await entry.session.list();
        const relocated = relocate(annotations, entry.blocks);

        // Persist only annotations whose status or anchor actually changed
        for (const r of relocated) {
          const original = annotations.find((a) => a.id === r.annotation.id);
          if (original) {
            const statusChanged = original.status !== r.annotation.status;
            const ordinalChanged = original.anchor.siblingOrdinal !== r.annotation.anchor.siblingOrdinal;
            if (statusChanged || ordinalChanged) {
              await entry.session.save(r.annotation);
            }
          }
        }

        entry.annotationCount = relocated.length;
        return json({ annotations });
      }

      // POST /api/annotations → entry file
      if (pathname === "/api/annotations" && req.method === "POST") {
        const entry = fileStore.get(fileStore.getEntryKey());
        if (!entry) {
          return json({ ok: false, error: "Entry file not found" }, 500);
        }

        const body = await req.json();
        const { anchor, blockType, blockText, blockLineRange, comment, id } = body;

        if (!anchor || !blockType || !comment) {
          return json(
            { ok: false, error: "Missing required fields: anchor, blockType, comment" },
            400
          );
        }

        // Validate anchor matches a current block (tier-1 or tier-2)
        const anchorStr = `${anchor.blockType}:${anchor.textHash}:${anchor.siblingOrdinal}`;
        const contentKey = `${anchor.blockType}:${anchor.textHash}`;
        const matchesExact = entry.blocks.some(
          (b) => `${b.anchor.blockType}:${b.anchor.textHash}:${b.anchor.siblingOrdinal}` === anchorStr
        );
        const matchesContent = entry.blocks.some(
          (b) => `${b.anchor.blockType}:${b.anchor.textHash}` === contentKey
        );
        if (!matchesExact && !matchesContent) {
          return json(
            { ok: false, error: "Anchor does not match any current block" },
            400
          );
        }

        const now = Date.now();
        const annotation: Annotation = {
          id: id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 8),
          anchor,
          blockType,
          blockText: blockText ?? "",
          blockLineRange: blockLineRange ?? [0, 0],
          comment,
          status: "ok",
          createdAt: now,
          updatedAt: now,
        };

        const saved = await entry.session.save(annotation);
        const relocated = relocate([saved], entry.blocks);
        const resolved = relocated[0]?.annotation;

        if (resolved) {
          await entry.session.save(resolved);
          entry.annotationCount = (await entry.session.list()).length;
          await regenerateReviewedFile(entry);
          return json({ annotation: resolved }, id ? 200 : 201);
        }

        entry.annotationCount = (await entry.session.list()).length;
        await regenerateReviewedFile(entry);
        return json({ annotation: saved }, id ? 200 : 201);
      }

      // DELETE /api/annotations/:id → entry file
      if (pathname.startsWith("/api/annotations/") && req.method === "DELETE") {
        const id = pathname.replace("/api/annotations/", "");
        if (!id) {
          return json({ ok: false, error: "Missing annotation id" }, 400);
        }

        const entry = fileStore.get(fileStore.getEntryKey());
        if (!entry) {
          return json({ ok: false, error: "Entry file not found" }, 500);
        }

        // Check existence BEFORE removing
        const annotations = await entry.session.list();
        const exists = annotations.some((a) => a.id === id);

        if (!exists) {
          return json({ ok: false, error: `Annotation ${id} not found` }, 404);
        }

        await entry.session.remove(id);
        entry.annotationCount = (await entry.session.list()).length;
        await regenerateReviewedFile(entry);
        return json({ ok: true });
      }

      // POST /api/done — keep as-is for now (Phase 4 changes it)
      if (pathname === "/api/done" && req.method === "POST") {
        const entry = fileStore.get(fileStore.getEntryKey());
        if (!entry) {
          return json({ ok: false, error: "Entry file not found" }, 500);
        }

        try {
          const annotations = await entry.session.list();
          const relocated = relocate(annotations, entry.blocks);
          const outputPath = await writeReview(entry.filePath, entry.source, relocated);

          // Build success response, schedule shutdown AFTER handler returns
          const response = json({ ok: true, path: outputPath });
          setTimeout(() => {
            bunServer.stop(true);
            fileStore.releaseAll();
            resolveStopped();
          }, 0);
          return response;
        } catch (err: any) {
          return json(
            { ok: false, error: err.message ?? "Failed to generate review" },
            500
          );
        }
      }

      // Fallback: 404
      return json({ ok: false, error: `Not found: ${pathname}` }, 404);
    },
  });

  const actualPort = bunServer.port ?? 0;
  const url = `http://localhost:${actualPort}`;

  return {
    url,
    port: actualPort,
    async stop() {
      bunServer.stop();
      await fileStore.releaseAll();
      resolveStopped();
    },
    stopped,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
