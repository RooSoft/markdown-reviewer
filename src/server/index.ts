import { join, basename as pathBasename, extname } from "node:path";
import { readFile, access } from "node:fs/promises";
import { loadDocument } from "./markdown-service";
import { relocate } from "./anchoring";
import { openSession, SessionLockedError } from "./annotation-service";
import { writeReview } from "../review/generator";
import type { BlockNode, Annotation } from "../shared/types";

// Re-export for consumers
export { SessionLockedError } from "./annotation-service";

// ---------------------------------------------------------------------------
// MIME types for static assets
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".ttf": "font/ttf",
  ".woff": "font/woff",
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
// Server
// ---------------------------------------------------------------------------

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { filePath, port = 0, tmpDir, fresh } = opts;

  // Load and parse document
  const { source, fileHash, blocks, fullHtml } = await loadDocument(filePath);

  // Open session (throws SessionLockedError if held)
  const baseName = pathBasename(filePath);
  const session = await openSession(baseName, fileHash, { tmpDir, fresh });

  // Read templates
  const pageHtml = await loadPageHtml();
  const appJs = await loadAppJs();

  // Inject full-document HTML (structurally correct: tables, nested lists, <th>, inline formatting)
  const renderedPage = pageHtml.replace("<!--BLOCKS-->", fullHtml);

  // Stopped promise — resolves when the server shuts down (via stop() or self-shutdown)
  let resolveStopped: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });

  // Start the HTTP server
  const bunServer = Bun.serve({
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
        const filePath = join(import.meta.dir, "..", "..", "public", relPath);
        try {
          await access(filePath);
          const ext = extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
          const data = await readFile(filePath);
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

      // GET /api/markdown
      if (pathname === "/api/markdown" && req.method === "GET") {
        return json({ source, blocks });
      }

      // GET /api/annotations
      if (pathname === "/api/annotations" && req.method === "GET") {
        const annotations = await session.list();
        const relocated = relocate(annotations, blocks);

        // Persist updated status / rebound anchors
        for (const r of relocated) {
          await session.save(r.annotation);
        }

        return json({ annotations });
      }

      // POST /api/annotations
      if (pathname === "/api/annotations" && req.method === "POST") {
        const body = await req.json();
        const {
          anchor,
          blockType,
          blockText,
          blockLineRange,
          comment,
          id,
        } = body;

        if (!anchor || !blockType || !comment) {
          return json(
            { ok: false, error: "Missing required fields: anchor, blockType, comment" },
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

        // Persist via session
        const saved = await session.save(annotation);

        // Relocate to determine status
        const relocated = relocate([saved], blocks);
        const resolved = relocated[0]?.annotation;

        if (resolved) {
          // Persist the relocated status
          await session.save(resolved);
          return json({ annotation: resolved }, id ? 200 : 201);
        }

        return json({ annotation: saved }, id ? 200 : 201);
      }

      // DELETE /api/annotations/:id
      if (pathname.startsWith("/api/annotations/") && req.method === "DELETE") {
        const id = pathname.replace("/api/annotations/", "");
        if (!id) {
          return json({ ok: false, error: "Missing annotation id" }, 400);
        }

        const annotations = await session.list();
        const exists = annotations.some((a) => a.id === id);

        await session.remove(id);

        if (!exists) {
          return json({ ok: false, error: `Annotation ${id} not found` }, 404);
        }

        return json({ ok: true });
      }

      // POST /api/done
      if (pathname === "/api/done" && req.method === "POST") {
        try {
          const annotations = await session.list();
          const relocated = relocate(annotations, blocks);
          const outputPath = await writeReview(filePath, source, relocated);

          // Build success response, schedule shutdown AFTER handler returns
          const response = json({ ok: true, path: outputPath });
          setTimeout(() => {
            bunServer.stop(true);
            session.release();
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
      await session.release();
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
