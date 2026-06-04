# Phase 2 — Markdown service: relative link detection

**Status:** `DONE`
**Depends on:** Phase 1 (Server per-file state)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 2. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `specs/002-multi-file-review` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/002/02-link-detection.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** Phase 1 added `FileStore` + per-file `/api/files*` routes and now writes reviewed output as `.mdr`. `loadDocument` currently returns `{ source, fileHash, blocks, fullHtml }` and is called without options — this phase adds optional link-detection options and a `links` field.
- **Definition of done:** all Work items + Acceptance criteria ticked; gates green (`bun run typecheck`, `bun test`); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit.

---

## Files touched

- `src/server/markdown-service.ts` — add link detection + AST-based marking; extend `loadDocument`.
- `src/shared/types.ts` — add `MdLink` interface.
- `src/server/index.ts` — pass `sessionRoot`/`currentFileDir` into `loadDocument` and return `links` from `GET /api/files/:key`.

## Pre-flight check (resume-after-compaction hint)

```sh
# Current remark pipeline + where mdast→hast→html happens
rg -n "remark|unified|toHtml|hast|mdast|visit|loadDocument|parseDocument" src/server/markdown-service.ts
# Confirm MdLink not yet defined and links not yet returned
rg -n "MdLink|data-md-link|detectMdLinks|markNavigationalLinks|links" src/server/markdown-service.ts src/shared/types.ts
bun run typecheck && bun test
```

If a step's outputs show the code already exists, that step is done — skip it and re-run its tests to confirm.

## Data model

```ts
export interface MdLink {
  originalUrl: string;   // the href as written in markdown
  resolvedKey: FileKey;  // relative to sessionRoot
  resolvedPath: string;  // absolute path (realpath-normalized)
}
```

A link is **navigational** iff ALL of:
- url path ends with `.md` (case-insensitive); a `#hash` fragment is allowed, a `?query` is not;
- url is relative (no URI scheme, no leading `/`);
- the decoded path, resolved against the **directory of the file that contains the link**, is an existing **regular** file;
- the resolved path is normalized with `realpath` before key generation.

> **`.mdr` files are non-navigational by construction.** Detection only matches `.md`. Generated review files end in `.mdr`, so a link to one (or its accidental presence on disk) is never marked. No extra exclusion logic is needed; do not special-case `.mdr` — just never broaden the match beyond `.md`.

## API contract / implementation

### 1. Link detection function

Add to `src/server/markdown-service.ts`:

```ts
/**
 * Detect relative .md links in a markdown source and resolve them
 * to file keys relative to the session root.
 */
export async function detectMdLinks(
  source: string,
  opts: { currentFileDir: string; sessionRoot: string }
): Promise<MdLink[]>;
```

### 2. AST-based marking (no HTML string surgery)

While converting mdast → hast, set navigation attributes on link nodes **before** `toHtml()` renders. Do **not** regex/post-process the final HTML string — that is fragile for duplicate links, entity-encoded hrefs, and title attributes.

```ts
export async function markNavigationalLinks(
  tree: Root,
  opts: { currentFileDir: string; sessionRoot: string }
): Promise<{ links: MdLink[] }> {
  // 1. Visit mdast link nodes
  // 2. Filter to relative .md links (rules above)
  // 3. Resolve each against opts.currentFileDir
  // 4. realpath + require existing regular file
  // 5. Compute resolvedKey = relative(opts.sessionRoot, resolvedPath)
  // 6. Set node.data.hProperties["data-md-link"] = resolvedKey
  // 7. Return valid links
}
```

The `data-md-link` attribute carries the file key; the frontend (Phase 3) intercepts clicks on `[data-md-link]`.

### 3. Extend `loadDocument` / `parseDocument`

```ts
export async function loadDocument(
  path: string,
  opts?: { sessionRoot?: string; currentFileDir?: string }
): Promise<{
  source: string;
  fileHash: string;
  blocks: BlockNode[];
  fullHtml: string;
  links: MdLink[];  // NEW
}>;
```

If either option is missing, `links` is `[]` and no navigation attributes are added (backward compatible — Phase 1's entry-file load and all existing tests keep passing).

### 4. Server route wiring

In `GET /api/files/:key`: call `loadDocument(resolvedPath, { sessionRoot: fileStore.getSessionRoot(), currentFileDir: dirname(resolvedPath) })` and return `links`, `fullHtml`, and `blocks`.

## Work items

Tick each box as you complete it. Commit after each logical group.

- [x] Add `MdLink` to `src/shared/types.ts`.
- [x] Implement `detectMdLinks` and `markNavigationalLinks` operating on the AST/hast tree (not rendered HTML).
- [x] Extend `loadDocument`/`parseDocument` with optional `sessionRoot`/`currentFileDir` and a `links` return field (backward compatible when omitted).
- [x] Wire `GET /api/files/:key` to pass the options and return `links`.
- [x] Add unit tests for the detection rules (see Acceptance criteria).

## Acceptance criteria

- [x] `detectMdLinks` identifies relative `.md` links and resolves them against the **current file's** directory (e.g. in `nested/one.md`, `./two.md` → `nested/two.md`, not session-root `two.md`).
- [x] Links with schemes (`http://`, `mailto:`) are NOT navigational.
- [x] Links without `.md`, and `.mdr` links, are NOT navigational; `.MD` is accepted case-insensitively.
- [x] Absolute paths (`/absolute/path.md`) and query strings (`./file.md?x=1`) are NOT navigational; `#hash` fragments ARE allowed.
- [x] `data-md-link` is added via AST/hast properties, not string replacement on rendered HTML.
- [x] `loadDocument` returns a `links` array and `fullHtml` contains the marked navigational links; omitting the options yields `links: []` and unchanged HTML.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## When done

1. Verify the acceptance criteria above are fully ticked.
2. `bun run typecheck && bun test`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 2 to `DONE` (same commit).
5. Commit on the spec branch. Move to [`03-frontend-multi-file.md`](03-frontend-multi-file.md).
