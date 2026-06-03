# Phase 4 — Review generator (`_reviewed.md`)

**Status:** `DONE`
**Depends on:** Phase 1, Phase 2, Phase 3
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 4. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

Hand the cold-start `worker` exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals.
- **Prior phases landed:** Phase 1 has `src/shared/types.ts` (`Annotation`, `BlockNode` with `endOffset`). Phase 2 has `parseDocument(source)` → `{ source, blocks }` (each block carries `endOffset` = absolute index into source, `lineRange` advisory, `type`, `anchor`) and `relocate(annotations, blocks): Relocated[]` where `Relocated = { annotation, block | null }`. Locate splice points via `relocated.block.endOffset`, never via `remark-stringify`, and never by re-matching anchors yourself.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun run typecheck` clean and `bun test` green (this phase adds tests); committed with this file's `Status:` and the root dashboard row both `DONE`.

---

## Files touched

- `src/review/generator.ts` — build `_reviewed.md` by splicing into the original source string
- `src/review/generator.test.ts` — `bun:test`

## Pre-flight check

```sh
rg -n "export (async )?function (generateReview|sanitizeComment|writeReview)" src/review/generator.ts 2>/dev/null
bun test src/review/generator.test.ts 2>/dev/null
```

## Core invariant: SOURCE FIDELITY — never re-serialize

The generator **splices comments into the original source string**. It must **never** regenerate markdown from the AST (no `remark-stringify`, which is not even a dependency). Re-serializing would reflow tables, normalize bullets/whitespace, and produce a noisy diff. The AST/blocks are used **only** to locate byte offsets; all output is built from the original text with comments inserted at block boundaries.

## Contract

```typescript
import type { Relocated } from "../server/anchoring"; // { annotation: Annotation; block: BlockNode | null }

// Pure: given the original source and the relocate() output, return the full _reviewed.md string.
// Each Relocated carries its resolved block (or null = orphaned) — DO NOT re-find blocks by anchor here
// (a `stale` annotation's textHash no longer matches its block, so an anchor lookup would miss it).
// Splice at relocated.block.endOffset. No disk I/O here.
export function generateReview(source: string, relocated: Relocated[]): string;

// Convenience wrapper used by the server's /api/done: relocate + generate + write to disk.
// Returns the written path. Throws on write failure (server must stay up and report — see Phase 5).
export function writeReview(sourcePath: string, source: string, relocated: Relocated[]): Promise<string>;
```

Output path: `<source-dir>/<basename-without-ext>_reviewed.md` (e.g. `docs/proposal.md` → `docs/proposal_reviewed.md`).

## Output format (authoritative — see the Worked example at the bottom of this file)

The file has two parts separated by a `---` rule.

### 1. Summary section (top, for quick scanning)

```markdown
# Review of <basename>.md

**Total annotations:** <N>

## Annotations

### 1. <BlockType>: "<short context>" (~lines A-B)

> <comment>

### 2. Paragraph (~lines A-B)

> <comment>
...
```

- Number annotations `[1..N]` in **source order** (sort by the block's source position / `endOffset`). The same `[N]` is reused for the inline marker, so summary and inline markers stay in lockstep.
- Heading entries include the heading's text as context (`Heading: "Introduction"`); paragraph/list-item entries may use just the block type. Line numbers are written as `~lines A-B` (or `~line A` when A===B) and are **advisory** — from `blockLineRange`.
- **Orphaned annotations** (status `"orphaned"`) are NOT given an inline marker (their block no longer exists). List them in the summary under a clearly labeled subsection:

  ```markdown
  ## Unresolved / orphaned annotations

  These annotations could not be re-located in the current document:

  ### O1. (was <BlockType>, ~lines A-B)

  > <comment>
  ```

  Never drop them.

### 2. Separator + full original document with inline markers

```markdown
---

<!-- Full document with inline review comments. Line numbers above are advisory. -->

<the ORIGINAL source, byte-for-byte, with <!-- Review: [N] ... --> spliced in>
```

- Start from the **original `source` string** and insert each non-orphaned annotation's marker at its `relocated.block.endOffset` (orphaned = `block === null`, skipped here, handled in the summary subsection). Build the spliced string by processing insertions from the **end backward** (or a single left-to-right pass with a running delta) so earlier insertions don't invalidate later offsets. When two annotations share the same `endOffset`, keep them in ascending `[N]` order.
- Marker form: `<!-- Review: [N] <sanitized comment> -->`.
- Place the marker on its **own line** where the block structure allows, to minimize diff noise — for a heading/paragraph, append after the block (a trailing inline marker as in the Worked example below is acceptable; prefer own-line when the next thing is a blank line). Be consistent.

## Comment encoding — must not corrupt the document

- **Sanitize comment bodies:** any `-->` or `--` sequence in user text must be escaped before insertion so it can't terminate the HTML comment early. Replace `--` with a safe form (e.g. `‑‑` or `- -` / a documented escape) so `-->` can never appear inside the body. Whatever scheme you pick, a test must prove a comment containing literal `-->` produces a still-valid single HTML comment.
- **Fenced code blocks are annotated at block level only:** place the marker **after the closing fence**, never inside the code (a `<!-- -->` inside a code block renders as literal text). Use the code block's `endOffset` (which is after the closing fence) — do not compute a position inside the fence.
- Blocks whose source already contains `<!-- -->` are handled by the same escaping rules — only the inserted marker is sanitized; the user's original source content is spliced verbatim and untouched.

## Work items

### 1. Generator core
- [x] `sanitizeComment(text)` — neutralizes `--` / `-->` so the inserted comment can never close early; idempotent and tested.
- [x] `generateReview(source, relocated)` — summary section + `---` + spliced original, numbering in source order, orphans (`block === null`) in their own subsection, markers inserted at `relocated.block.endOffset` (which, for `code`, is already after the closing fence).
- [x] `writeReview(...)` — compute the output path and write the file; return the path; surface write errors (do not swallow).

### 2. Tests
- [x] Source fidelity: a doc with a GFM table + mixed bullets round-trips **byte-for-byte** except for the inserted markers (assert the original substring between markers is untouched).
- [x] Numbering: summary `[N]` matches the inline `[N]` for the same annotation, in source order.
- [x] Code block: marker lands **after** the closing ``` fence, never between the fences.
- [x] Encoding: a comment containing `-->` yields exactly one valid HTML comment (no early termination, document not corrupted).
- [x] Orphans: an `"orphaned"` annotation appears in the "Unresolved / orphaned" subsection and produces **no** inline marker.
- [x] Output matches the **Worked example** below for that input (summary heading, total count, separator comment line, marker placement).

## Acceptance criteria

- [x] (a) `bun test src/review/generator.test.ts` is green.
- [x] (b) `bun run typecheck` clean.
- [x] (c) `rg "remark-stringify" src` returns nothing — the generator never re-serializes.
- [x] (d) Given the **Worked example** input below + its 3 annotations, the generated string contains the summary section, the `---` separator, and the three `<!-- Review: [1..3] ... -->` markers at the right blocks (heading inline, paragraph on its own line, list item inline).

## Worked example (the canonical golden test — self-contained)

This is the exact input/output the acceptance criteria reference. Build a `bun:test` fixture from it.

**Input** — `proposal.md`:

```markdown
# Introduction

Some introductory text here...

A longer paragraph with several sentences
that spans multiple lines.

- Item one
- Item two
- Item three
```

**Three annotations** (already re-located; all `status: "ok"`):

| `[N]` | block | `blockLineRange` | comment |
| --- | --- | --- | --- |
| 1 | `heading` "Introduction" | `[1, 1]` | `Clarify the target audience in the first sentence.` |
| 2 | `paragraph` "A longer paragraph…" | `[5, 6]` | `This section needs more concrete examples. Consider adding a table comparing approaches.` |
| 3 | `listItem` "Item two" | `[9, 9]` | `Is this still accurate? The API changed in v2.` |

**Expected `proposal_reviewed.md`:**

```markdown
# Review of proposal.md

**Total annotations:** 3

## Annotations

### 1. Heading: "Introduction" (~line 1)

> Clarify the target audience in the first sentence.

### 2. Paragraph (~lines 5-6)

> This section needs more concrete examples. Consider adding a table comparing approaches.

### 3. List item (~line 9)

> Is this still accurate? The API changed in v2.

---

<!-- Full document with inline review comments. Line numbers above are advisory. -->

# Introduction <!-- Review: [1] Clarify the target audience in the first sentence. -->

Some introductory text here...

A longer paragraph with several sentences
that spans multiple lines.
<!-- Review: [2] This section needs more concrete examples. Consider adding a table comparing approaches. -->

- Item one
- Item two <!-- Review: [3] Is this still accurate? The API changed in v2. -->
- Item three
```

Note the marker placement: heading → trailing inline; paragraph → its own line after the block; list item → trailing inline on that `- Item two` line. The original document text between markers is byte-for-byte unchanged. Exact line-number formatting (`~line N` vs `~lines A-B`) and the precise advisory ranges are up to your `lineRange` computation — the load-bearing assertions are the marker contents, their `[N]` numbering in source order, and source fidelity.

## When done

1. Verify acceptance list ticked.
2. `bun run typecheck && bun test`.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 4 row to `DONE`.
4. Commit. Move to [`05-http-server-and-api.md`](05-http-server-and-api.md).
