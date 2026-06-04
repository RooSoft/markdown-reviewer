import { dirname } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { detectMdLinks } from "./markdown-service";
import {
  addFileToSessionManifest,
  writeSessionMarkers,
  readSessionMarker,
  mergeSessions,
  saveSessionManifest,
  type SessionManifest,
} from "./session-manifest";
import type { MdLink } from "../shared/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestRef {
  get(): SessionManifest;
  set(m: SessionManifest): void;
}

// ---------------------------------------------------------------------------
// Auto-discover: cycle-safe BFS of the relative-.md link graph
// ---------------------------------------------------------------------------

/**
 * Crawl the relative-.md link graph from an entry file and register every
 * reachable file into the session manifest.
 *
 * - Cycle-safe via a `visited` set keyed by realpath
 * - Per-file parse failure is non-fatal (skip and continue)
 * - Register-only: does NOT open annotation locks or render HTML
 */
export async function autoDiscover(
  entryAbsPath: string,
  sessionRoot: string,
  tmpDir: string,
  manifestRef: ManifestRef,
): Promise<void> {
  const visited = new Set<string>();
  const queue: string[] = [entryAbsPath];

  // P2: pre-compute realpath cache for manifest entries so registerSessionMember
  // can do O(1) lookup instead of O(N) realpath calls per discovered file.
  // The cache is shared across all registerSessionMember calls during the crawl.
  const manifestRealPathCache = new Map<string, string>();
  for (const f of manifestRef.get().files) {
    const rp = await realpath(f.filePath).catch(() => null) ?? f.filePath;
    manifestRealPathCache.set(f.filePath, rp);
  }

  while (queue.length) {
    const cur = queue.shift()!;

    // Resolve realpath — if the file doesn't exist, realpath fails
    const real = await realpath(cur).catch(() => null);
    if (!real || visited.has(real)) continue;

    // Skip non-.md files (detectMdLinks already filters, but be defensive)
    if (!real.toLowerCase().endsWith(".md")) continue;

    visited.add(real);

    // Register this file as a session member (no-op if already in manifest)
    try {
      await registerSessionMember(real, sessionRoot, tmpDir, manifestRef, manifestRealPathCache);
    } catch {
      // Per-file registration failure is non-fatal — skip this file
      continue;
    }

    // Parse to get outgoing links, then enqueue unvisited targets
    try {
      const source = await readFile(real, "utf-8");
      const links: MdLink[] = await detectMdLinks(source, {
        currentFileDir: dirname(real),
        sessionRoot,
      });
      for (const link of links) {
        if (!visited.has(link.resolvedPath)) {
          queue.push(link.resolvedPath);
        }
      }
    } catch {
      // Per-file parse failure is non-fatal — skip this file's links
      // but the file is already registered above
    }
  }

  // Final save to persist the manifest after all registrations
  // (best-effort — may fail if tmpDir was cleaned up)
  try {
    await saveSessionManifest(manifestRef.get(), tmpDir);
  } catch {
    // Ignore — tmpDir may have been cleaned up
  }
}

// ---------------------------------------------------------------------------
// Internal: register a file as a session member
// ---------------------------------------------------------------------------

async function registerSessionMember(
  filePath: string,
  _sessionRoot: string,
  tmpDir: string,
  manifestRef: ManifestRef,
  manifestRealPathCache: Map<string, string>,
): Promise<void> {
  const currentManifest = manifestRef.get();
  const currentSessionId = currentManifest.id;

  // Check if this file is already in the manifest (by cached realpath comparison).
  // This handles the entry file which was already registered by loadOrCreateSessionManifest
  // using a potentially non-realpath'd path.
  const real = await realpath(filePath);

  // P2: use pre-computed realpath cache for O(1) lookup instead of O(N) per call.
  // Cache new entries as they're added so future lookups stay fast.
  for (const f of currentManifest.files) {
    let existingReal = manifestRealPathCache.get(f.filePath);
    if (!existingReal) {
      existingReal = await realpath(f.filePath).catch(() => null) ?? f.filePath;
      manifestRealPathCache.set(f.filePath, existingReal);
    }
    if (existingReal === real) return; // Already registered — skip
  }

  // Check if this file already belongs to a different session
  const existingSession = await readSessionMarker(filePath, tmpDir);

  if (existingSession && existingSession !== currentSessionId) {
    // Merge — older session survives
    // During auto-discover we don't hold locks for all files,
    // so ownedPaths is empty (Phase 5 handles best-effort for unowned paths)
    const survivor = await mergeSessions(
      currentSessionId,
      existingSession,
      tmpDir,
      [],
    );
    manifestRef.set(survivor);
  }

  // Write session markers with current session id
  await writeSessionMarkers(filePath, tmpDir, manifestRef.get().id);

  // Add to manifest (idempotent if already present)
  const updated = await addFileToSessionManifest(manifestRef.get(), filePath, tmpDir);
  manifestRef.set(updated);
}
