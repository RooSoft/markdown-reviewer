# Phase 2 — Markdown parsing, block render & anchoring

**Status:** `DONE`
**Depends on:** Phase 1
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 2. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals.
- **Prior phases landed:** Phase 1 created the scaffold, `package.json` with the unified/remark v11 deps, `tsconfig.json`, and `src/shared/types.ts` (`BlockAnchor`, `BlockNode`, `Annotation`). Import those types — do not redefine them.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun run typecheck` clean and `bun test` green (this phase adds unit tests); committed with this file's `Status:` and the root dashboard row both `DONE`.

---

## Files touched

- `src/server/markdown-service.ts` — read markdown, compute file hash, parse AST, render annotatable blocks to HTML, return `{ source, blocks }`
- `src/server/anchoring.ts` — composite-anchor computation + re-location / stale / orphan logic
- `src/server/markdown-service.test.ts`, `src/server/anchoring.test.ts` — `bun:test` unit tests

## Pre-flight check (resume-after-compaction hint)

```sh
rg -n "export (async )?function (parseDocument|renderBlocks|computeAnchor|relocate)" src/server 2>/dev/null
bun test src/server 2>/dev/null
```

If the functions exist and tests pass, this phase is done — re-run the tests to confirm.

## What this phase produces (the contract later phases consume)

A `markdown-service` module exposing (names are guidance; keep them stable once chosen):

```typescript
import type { BlockNode, BlockAnchor, Annotation } from "../shared/types";

// Parse + render. Returns the raw source (for the generator) and the clickable blocks (for the page).
export function parseDocument(source: string): { source: string; blocks: BlockNode[] };

// Convenience: read file from disk, hash it, parse.
export function loadDocument(path: string): Promise<{ source: string; fileHash: string; blocks: BlockNode[] }>;
```

And an `anchoring` module:

```typescript
export function computeAnchor(node, index: number | undefined): BlockAnchor;

// The binding relocate computed for one annotation. `block` is null iff orphaned.
// Defined and exported here (server-internal, not a persisted wire type).
export interface Relocated { annotation: Annotation; block: BlockNode | null; }

// Sets each annotation's .status (+ rebinds anchor.siblingOrdinal on tier-2) AND returns the
// resolved block so downstream consumers never re-derive the binding. See the four-tier algo below.
export function relocate(annotations: Annotation[], blocks: BlockNode[]): Relocated[];
```

> Returning the binding (`Relocated.block`) matters: a `stale` annotation's `textHash` no longer matches its block, so the review generator (Phase 4) **cannot** re-find the block by anchor — it must use the `block` that `relocate` already resolved. The API layer (Phase 5) reads `.annotation` (to persist updated status/anchor) and the generator reads `.block.endOffset` (to splice).

## Anchoring — the load-bearing detail (implement exactly)

Each block is anchored by a **composite key**:

```
blockType : normalizedTextHash : siblingOrdinal
```

- **`blockType`** — the mdast node `type` (`heading`, `paragraph`, `listItem`, `tableCell`, `code`, `blockquote`, …).
- **`normalizedTextHash`** — a short hash of the block's **own inline text only**, after normalization. Normalization: collapse internal whitespace to single spaces, trim, and **lowercase for headings**. Use a short stable hash (e.g. first 8 hex chars of a SHA-256, or a small FNV-1a) — keep it short; collisions are disambiguated by `siblingOrdinal`.
  - ⚠ Compute the text from the node's **own** inline content, NOT a container's recursive text. On a `listItem`, `mdast-util-to-string` would otherwise concatenate nested sublist text (e.g. `"nested parentdeep adeep btwo"`) and the hash would shift when unrelated children change. For container nodes, stringify only the node's direct inline/paragraph content, excluding nested list/quote children.
- **`siblingOrdinal`** — the block's index within its **immediate** parent container — exactly the `index` argument `unist-util-visit` hands the visitor `(node, index, parent)`. Scoped to the immediate parent, not the document: items in a nested sublist number independently of the outer list.

Line numbers (`position.start.line`..`position.end.line`) are recorded into `BlockNode.lineRange` but treated as **advisory only** — display, never re-location.

### Re-location on resume (`relocate`)

> **Why four tiers, not two — read this carefully.** A naive scheme of just "exact composite key → `blockType+siblingOrdinal` fallback (stale) → orphan" has a real defect: inserting or deleting a block *above* an unedited block shifts its `siblingOrdinal`, so the unedited block fails BOTH the exact match (ordinal changed) AND the position fallback (ordinal changed) → it is wrongly **orphaned** even though its content is byte-identical. To prevent orphaning unchanged content, `relocate` matches in **four** tiers, with a content-hash tier ahead of the position tier. `textHash` (content) is the stronger signal than `siblingOrdinal` (position), so content-moved beats position-changed.

For each persisted annotation, against the freshly parsed `blocks`, in priority order — **first matching tier wins**:

1. **Exact composite** — a block with the same `blockType` **and** `textHash` **and** `siblingOrdinal` → `status: "ok"`. (Unchanged document, common case.)
2. **Content moved** — a block with the same `blockType` **and** `textHash` but a **different** `siblingOrdinal` → content is intact, only its position shifted (something was inserted/deleted elsewhere) → `status: "ok"`. Re-bind to that block and update the annotation's stored `anchor.siblingOrdinal` to the new value so the next resume hits tier 1. If multiple blocks share `(blockType, textHash)` (duplicate content), pick the one whose `siblingOrdinal` is **nearest** to the annotation's stored ordinal.
3. **Position match, content changed** — no content match, but a block with the same `blockType` **and** `siblingOrdinal` exists (the block at that slot was edited in place) → `status: "stale"` (UI shows a warning; the comment may no longer apply).
4. **No match** — `status: "orphaned"`. Preserve it (never drop); the UI surfaces orphans in a sidebar for reattach-or-discard.

Each current block may be claimed by at most one annotation; once a block is bound in an earlier tier/iteration, later annotations skip it (prevents two annotations collapsing onto the same block). Process annotations in a stable order (e.g. by stored `siblingOrdinal`, then `createdAt`) so the binding is deterministic.

```text
relocate(annotations, blocks):
  byExact   = map (blockType, textHash, siblingOrdinal) -> block
  byContent = multimap (blockType, textHash) -> [blocks]      # for tier 2, nearest-ordinal tiebreak
  byPos     = map (blockType, siblingOrdinal) -> block
  claimed   = set()
  for a in stableSort(annotations):
    k = a.anchor
    if (b = byExact[k]) and b not in claimed:           a.status="ok";    claim(b)
    elif (b = nearestByOrdinal(byContent[type,hash], k.siblingOrdinal, unclaimed)):
                                                        a.status="ok";    a.anchor.siblingOrdinal=b.ordinal; claim(b)
    elif (b = byPos[type, k.siblingOrdinal]) and b not in claimed:
                                                        a.status="stale"; claim(b)
    else:                                               a.status="orphaned"; bound=null
    results.append({ annotation: a, block: bound })     # bound is the claimed block, or null when orphaned
  return results
```

`relocate` must be **pure** (no disk writes); it returns one `Relocated` per input annotation, each `.annotation` carrying an updated `status` (and, for tier-2 rebinds, an updated `anchor.siblingOrdinal`) and each `.block` carrying the resolved block (or `null` when orphaned). Persisting the new status/anchor is the storage layer's job (Phase 3), invoked by the API layer (Phase 5) — not this function's.

## Render — single-pass clickable HTML via `hProperties`

Render the whole document to HTML in **one** `remark-rehype` → `hast-util-to-html` pass, with `data-block-id` already stamped on every clickable element:

- A small unified plugin walks the mdast tree (via `unist-util-visit`) and, for each **annotatable** node, sets `node.data.hProperties['data-block-id'] = id` and (recommended) `node.data.hProperties['data-anchor'] = serializeAnchor(anchor)`. Assign ids sequentially (`b0`, `b1`, …) in document order.
- Per-block HTML for `BlockNode.html`: you may either (a) render the full document once and also expose per-block HTML by rendering each annotatable subtree, or (b) render the full page HTML in the server phase and have `blocks[].html` carry each block's serialized fragment. Choose one and keep it consistent; the server phase needs *both* a full-page render and per-block ids. Simplest: stamp ids in the mutated tree, render the full document HTML for the page, and also serialize each annotatable node individually for `BlockNode.html`.

### Pipeline assembly (verified against v11)

```
unified()
  .use(remarkParse)
  .use(remarkGfm)            // tables, strikethrough, task lists — REQUIRED
  .use(remarkFrontmatter, ['yaml', 'toml'])  // makes frontmatter a positioned node we can skip
  .use(stampBlockIdsPlugin)  // your plugin: visit + set hProperties + collect BlockNode[]
  .use(remarkRehype, { allowDangerousHtml: true })
// then hast-util-to-html(tree, { allowDangerousHtml: true })
```

### Annotatable vs. skipped (decide membership in the plugin)

- **Annotatable:** `heading`, `paragraph`, `listItem`, `tableCell`, `code` (fenced/indented code blocks), `blockquote`, block-level image/link references.
- **Skipped (no id, not clickable):** `yaml`/`toml` frontmatter (positioned nodes from `remark-frontmatter`), `thematicBreak` (`---`), raw `html` blocks.
- **List items:** stamp the id on the `listItem` node and **skip the `paragraph`** mdast wraps its content in. `remark-rehype` drops that `<p>` in *tight* lists, so an id on the inner paragraph would have no DOM element — you'd mint phantom ids. Anchor on `listItem`; do not also stamp its wrapped paragraph.

## Source offsets (recorded now, used by the generator in Phase 4)

Every node's `position.start.offset` / `position.end.offset` is an absolute, contiguous index into the source string. `BlockNode.endOffset: number` is **already declared in `src/shared/types.ts`** (Phase 1) precisely so this doesn't become a mid-stream type change — **populate it** from each node's `position.end.offset` so Phase 4 can insert markers at exact byte boundaries without line heuristics. For `code` (fenced) blocks, `position.end.offset` lands **after** the closing fence — that is exactly where the generator wants the marker, so record it as-is; do not adjust it inward.

## Work items

### 1. Anchoring module
- [x] `computeAnchor(node, index)` → `BlockAnchor` with normalized own-text hash + heading lowercasing + immediate-parent `siblingOrdinal`.
- [x] `relocate(annotations, blocks)` implementing the four tiers (exact → content-moved → position-changed/stale → orphan) with one-block-one-claim, pure (no I/O), rebinding `siblingOrdinal` on tier-2 matches.
- [x] A `serializeAnchor` / `parseAnchor` pair for the `blockType:textHash:siblingOrdinal` string form (used in `data-anchor` and storage).

### 2. Markdown service
- [x] `parseDocument(source)` assembling the pipeline above, stamping ids, collecting `BlockNode[]` (with `lineRange` advisory + `endOffset`), and returning full-page HTML or per-block HTML per your chosen approach.
- [x] `loadDocument(path)` reading the file, computing a stable `fileHash` (used by Phase 3 for the session dir name), and delegating to `parseDocument`.
- [x] Correctly **skip** frontmatter / thematic breaks / raw HTML, and anchor list items on `listItem` (not the wrapped paragraph).

### 3. Tests (`bun:test`)
- [x] Anchor stability: editing block B's text does not change block A's anchor.
- [x] `siblingOrdinal` is per immediate parent: a nested sublist's items number independently of the outer list.
- [x] Heading hash is case-insensitive; paragraph hash is not.
- [x] Two identical `- Item one` list items get distinct anchors (different ordinals).
- [x] `relocate`: unchanged doc → all `ok` (tier 1); **inserting a new paragraph above an unedited block → that block stays `ok` (tier 2), NOT orphaned**, and its stored `siblingOrdinal` is rebound to the new position; editing a block's text in place → `stale` (tier 3); deleting a block entirely → `orphaned` (tier 4).
- [x] `relocate`: two annotations never collapse onto the same current block (one-block-one-claim); duplicate `(blockType, textHash)` content rebinds to the nearest-ordinal block.
- [x] List-item id lands on the `<li>` in the rendered HTML and there is **no** phantom id on a dropped tight-list `<p>`.
- [x] Frontmatter / `---` / raw HTML blocks produce **no** `data-block-id`.

## Acceptance criteria

- [x] (a) `bun test src/server` is green.
- [x] (b) `bun run typecheck` clean.
- [x] (c) Rendered HTML for a sample doc contains `data-block-id` on headings, paragraphs, `<li>`, table cells, code blocks, and blockquotes — and none on frontmatter/thematic-break/raw-HTML.
- [x] (d) `relocate` returns exactly one `Relocated` per input annotation (orphans preserved as `{ annotation, block: null }`, never dropped), and an unedited block that only shifted position resolves to `status: "ok"` with a non-null `block`.

## When done

1. Verify acceptance list ticked.
2. `bun run typecheck && bun test`.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 2 row to `DONE`.
4. Commit on the branch. Move to [`03-annotation-storage.md`](03-annotation-storage.md).
