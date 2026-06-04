# Phase 6 — `--auto-discover`: eager link-graph crawl into the session

**Status:** `TODO`
**Depends on:** Phase 2 (Link detection), Phase 5 (Session manifest + merge)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 6. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `specs/002-multi-file-review` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/002/06-auto-discover.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** Phase 2 exposes `detectMdLinks(source, { currentFileDir, sessionRoot }) → MdLink[]` (`MdLink` has `originalUrl`, `resolvedKey`, `resolvedPath`). Phase 5 owns the session manifest (`loadOrCreateSessionManifest`, `addFileToSessionManifest`, `writeSessionMarkers`, `saveSessionManifest`, `mergeSessions`, `readSessionMarker`) and the running-session-id state, and `GET /api/session-files` returns the manifest-backed file list the Files zone renders.
- **Definition of done:** all Work items + Acceptance criteria ticked; gates green (`bun run typecheck`, `bun test`); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit.

---

## What changes

Add a `--auto-discover` CLI flag. When set, after the entry file is loaded the server eagerly walks the **relative-`.md` link graph** reachable from the entry file and registers every reachable file into the session manifest — so the whole "doc cluster" appears in the Files zone immediately, without the user clicking through each link.

This is **register-only**, not full-load: the crawl reads + parses each reachable file just enough to extract *its* links and add it to the manifest. A file's HTML render and its per-file annotation lock are still acquired lazily, on first click, via the existing `GET /api/files/:key` (Phase 1) — exactly as a manually-visited file. Auto-discover therefore scales to a large cluster (e.g. 20 docs) without holding 20 locks or rendering everything at startup.

**Why this exists:** when editing one file in a tightly-linked doc set, edits often have repercussions in other files. If a linked file is never visited it never joins the session, and the Done prompt never mentions it — so an agent can miss that changing A requires updating F. Auto-discover maps the cluster up front; Phase 4's prompt then lists the un-annotated members as "related files" to check.

## Files touched

- `src/cli/index.ts` — parse `--auto-discover`; pass it through to `startServer`.
- `src/server/index.ts` — `ServerOptions.autoDiscover`; run the crawl at startup when set.
- `src/server/file-crawler.ts` — **new file** (the cycle-safe BFS), or a helper in `markdown-service.ts`.

## Pre-flight check (resume-after-compaction hint)

```sh
# CLI flag parsing + how flags reach startServer
rg -n "parseArgs|--port|--tmp-dir|--no-open|--fresh|startServer|ServerOptions" src/cli/index.ts src/server/index.ts
# Reuse, don't reinvent: link detection (Phase 2) + manifest helpers (Phase 5)
rg -n "detectMdLinks|loadOrCreateSessionManifest|addFileToSessionManifest|writeSessionMarkers|mergeSessions|readSessionMarker" src/server/markdown-service.ts src/server/*.ts
bun run typecheck && bun test
```

If a step's outputs show the code already exists, that step is done — skip it and re-run its tests to confirm.

## CLI contract

```
mdr <file> [options]
  --auto-discover   Crawl the relative-.md link graph from <file> and add every reachable file
                    to the session up front (cycle-safe). Default: off.
```

- Default `false`. Off ⇒ behavior is exactly today's (files join the session only when visited).
- Thread it as `ServerOptions.autoDiscover?: boolean` into `startServer`.

## Algorithm — cycle-safe BFS, register-only

Run after the entry file's session/manifest is established (Phase 5 startup), before responding to the first request.

```ts
async function autoDiscover(entryAbsPath: string, sessionRoot: string, tmpDir: string, manifestRef): Promise<void> {
  const visited = new Set<string>();       // realpath'd absolute paths already processed
  const queue: string[] = [entryAbsPath];

  while (queue.length) {
    const cur = queue.shift()!;
    const real = await realpath(cur).catch(() => null);
    if (!real || visited.has(real)) continue;   // cycle/dup guard — THE loop-breaker
    visited.add(real);

    // Register membership (reuse Phase 5). For the entry file this is a no-op (already a member).
    // If `real` already belongs to a DIFFERENT session, reuse the Phase 5 merge path so the
    // "older session survives" invariant holds (manifestRef may be swapped to the survivor).
    await registerSessionMember(real, sessionRoot, tmpDir, manifestRef);

    // Parse just enough to get this file's outgoing links, then enqueue unvisited targets.
    const source = await readFile(real, "utf-8");
    const links = await detectMdLinks(source, { currentFileDir: dirname(real), sessionRoot });
    for (const link of links) {
      if (!visited.has(link.resolvedPath)) queue.push(link.resolvedPath);
    }
  }
  await saveSessionManifest(currentManifest, tmpDir);
}
```

Rules:
- **Loop safety** is the `visited` set keyed by `realpath` — a file is processed once even in cycles (A↔B) or via multiple paths. This is the only mechanism needed; do not add depth/visit caps (root invariant: *no hard file cap*).
- **Relative `.md` only** — `detectMdLinks` already enforces relative-path + `.md` + existing-regular-file + non-`.mdr`. The crawl inherits all of that; it never follows schemes, absolute paths, query-string links, or `.mdr` files.
- **Register-only** — `registerSessionMember` adds the path to the manifest and writes its `.path`/`.session` markers (and merges per Phase 5 if it already belongs to another session). It does **not** open the annotation lock, parse blocks, or render HTML — `GET /api/files/:key` does that lazily on first click.
- **Per-file parse failure is non-fatal** — if a reachable file fails to read/parse, skip it (don't add it, don't crawl its links) and continue; the crawl must not abort the whole startup.
- **No new route** — discovered files surface through the existing `GET /api/session-files` (Phase 5). The frontend already populates and refreshes the Files zone from it.

## UI note

No new UI is required: the Files zone (Phase 3) renders whatever `GET /api/session-files` returns, and a discovered file loads lazily on click. **But** a 20-file cluster makes the zone long — ensure `#file-list` scrolls within the sidebar (e.g. `max-height` + `overflow:auto`) rather than pushing the layout. Match `DESIGN.md`; if you touch zone CSS, load the `impeccable` skill first (per Phase 3's rule).

## Work items

Tick each box as you complete it. Commit after each logical group.

- [ ] Parse `--auto-discover` in `src/cli/index.ts`; thread `autoDiscover` into `ServerOptions`/`startServer`.
- [ ] Implement the cycle-safe BFS (`src/server/file-crawler.ts`) reusing `detectMdLinks` (Phase 2) and `registerSessionMember`/manifest helpers (Phase 5); register-only, non-fatal per-file errors.
- [ ] Run the crawl at startup only when `autoDiscover` is set, after the Phase 5 manifest is established and before serving requests.
- [ ] Ensure `#file-list` scrolls for large clusters (CSS only; match `DESIGN.md`).
- [ ] Tests: cluster crawl + cycle + non-`.md`/`.mdr` exclusion + off-by-default (see Acceptance).

## Acceptance criteria

- [ ] `mdr <entry> --auto-discover` registers every relative-`.md` file reachable from `<entry>` into the session; `GET /api/session-files` returns all of them (including zero-annotation files) without any file being clicked.
- [ ] A cycle (A links B, B links A) terminates and yields each file exactly once.
- [ ] Files reached only via a scheme/absolute/query-string link, or `.mdr` files, are NOT discovered.
- [ ] Without the flag, startup behavior is unchanged (only the entry file is in the session until links are clicked).
- [ ] Discovered files are registered (in the manifest + zone) but not locked/rendered until first clicked (`GET /api/files/:key`).
- [ ] A discovered file that already belongs to another session triggers the Phase 5 merge (older survives).
- [ ] A reachable file that fails to parse is skipped without aborting the crawl.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## When done

1. Verify the acceptance criteria above are fully ticked.
2. `bun run typecheck && bun test`, plus a `curl`/CLI smoke test of `mdr <entry> --auto-discover` + `GET /api/session-files`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 6 to `DONE` (same commit).
5. Commit on the spec branch. Move to [`07-file-navigation.md`](07-file-navigation.md).
