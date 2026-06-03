# Phase 2 — Markdown parsing, block render & anchoring

**Status:** `TODO`
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
export function relocate(annotations: Annotation[], blocks: BlockNode[]): Annotation[]; // sets each .status + (re)aligns
```

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

For each persisted annotation, against the freshly parsed `blocks`:

1. **Exact match** — composite key (`blockType` + `textHash` + `siblingOrdinal`) found → `status: "ok"`.
2. **Fallback** — exact key missing but `blockType` + `siblingOrdinal` match a block → `status: "stale"` (content changed; UI shows a warning).
3. **Neither** — `status: "orphaned"`. Preserve it (never drop); the UI surfaces orphans in a sidebar for reattach-or-discard.

`relocate` must be pure (no disk writes); it returns annotations with updated `status`. Persisting the new status is the storage layer's job (Phase 3), not this function's.

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

Every node's `position.start.offset` / `position.end.offset` is an absolute, contiguous index into the source string. This phase does not splice, but **must not discard offsets** — expose `position.end.offset` on each `BlockNode` (add a field if needed, e.g. `endOffset: number`, or keep the raw node accessible) so Phase 4 can insert markers at exact byte boundaries without line heuristics. If you add a field, update `BlockNode` in `src/shared/types.ts` and note it here.

> If you extend `BlockNode`, prefer adding `endOffset: number` (absolute index into source). Record it; the generator depends on it.

## Work items

### 1. Anchoring module
- [ ] `computeAnchor(node, index)` → `BlockAnchor` with normalized own-text hash + heading lowercasing + immediate-parent `siblingOrdinal`.
- [ ] `relocate(annotations, blocks)` implementing exact → stale → orphan, pure (no I/O).
- [ ] A `serializeAnchor` / `parseAnchor` pair for the `blockType:textHash:siblingOrdinal` string form (used in `data-anchor` and storage).

### 2. Markdown service
- [ ] `parseDocument(source)` assembling the pipeline above, stamping ids, collecting `BlockNode[]` (with `lineRange` advisory + `endOffset`), and returning full-page HTML or per-block HTML per your chosen approach.
- [ ] `loadDocument(path)` reading the file, computing a stable `fileHash` (used by Phase 3 for the session dir name), and delegating to `parseDocument`.
- [ ] Correctly **skip** frontmatter / thematic breaks / raw HTML, and anchor list items on `listItem` (not the wrapped paragraph).

### 3. Tests (`bun:test`)
- [ ] Anchor stability: editing block B's text does not change block A's anchor.
- [ ] `siblingOrdinal` is per immediate parent: a nested sublist's items number independently of the outer list.
- [ ] Heading hash is case-insensitive; paragraph hash is not.
- [ ] Two identical `- Item one` list items get distinct anchors (different ordinals).
- [ ] `relocate`: unchanged doc → all `ok`; edited block text → `stale`; deleted block → `orphaned`.
- [ ] List-item id lands on the `<li>` in the rendered HTML and there is **no** phantom id on a dropped tight-list `<p>`.
- [ ] Frontmatter / `---` / raw HTML blocks produce **no** `data-block-id`.

## Acceptance criteria

- [ ] (a) `bun test src/server` is green.
- [ ] (b) `bun run typecheck` clean.
- [ ] (c) Rendered HTML for a sample doc contains `data-block-id` on headings, paragraphs, `<li>`, table cells, code blocks, and blockquotes — and none on frontmatter/thematic-break/raw-HTML.
- [ ] (d) `relocate` never returns fewer annotations than it was given (orphans preserved, not dropped).

## When done

1. Verify acceptance list ticked.
2. `bun run typecheck && bun test`.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 2 row to `DONE`.
4. Commit on the branch. Move to [`03-annotation-storage.md`](03-annotation-storage.md).
