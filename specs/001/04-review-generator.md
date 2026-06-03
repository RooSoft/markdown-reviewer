# Phase 4 — Review generator (`_reviewed.md`)

**Status:** `TODO`
**Depends on:** Phase 1, Phase 2, Phase 3
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 4. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

Hand the cold-start `worker` exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals.
- **Prior phases landed:** Phase 1 has `src/shared/types.ts` (`Annotation`, `BlockNode`). Phase 2 has `parseDocument(source)` → `{ source, blocks }` with each block carrying `endOffset` (absolute index into source), `lineRange` (advisory), `type`, and its `anchor`; and `relocate(annotations, blocks)`. Use those — locate splice points via block `endOffset`, never via `remark-stringify`.
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
import type { Annotation, BlockNode } from "../shared/types";

// Pure: given the original source, the parsed blocks, and the (already re-located) annotations,
// return the full _reviewed.md content string. No disk I/O here.
export function generateReview(source: string, blocks: BlockNode[], annotations: Annotation[]): string;

// Convenience wrapper used by the server's /api/done: parse + relocate + generate + write to disk.
// Returns the written path. Throws on write failure (server must stay up and report — see Phase 5).
export function writeReview(sourcePath: string, source: string, blocks: BlockNode[], annotations: Annotation[]): Promise<string>;
```

Output path: `<source-dir>/<basename-without-ext>_reviewed.md` (e.g. `docs/proposal.md` → `docs/proposal_reviewed.md`).

## Output format (match the README example exactly)

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

- Start from the **original `source` string** and insert each non-orphaned annotation's marker at its block's `endOffset`. Build the spliced string by processing insertions in a single left-to-right pass (or from the end backward) so earlier insertions don't invalidate later offsets.
- Marker form: `<!-- Review: [N] <sanitized comment> -->`.
- Place the marker on its **own line** where the block structure allows, to minimize diff noise — for a heading/paragraph, append after the block (a trailing inline marker as in the README example is acceptable; prefer own-line when the next thing is a blank line). Be consistent.

## Comment encoding — must not corrupt the document

- **Sanitize comment bodies:** any `-->` or `--` sequence in user text must be escaped before insertion so it can't terminate the HTML comment early. Replace `--` with a safe form (e.g. `‑‑` or `- -` / a documented escape) so `-->` can never appear inside the body. Whatever scheme you pick, a test must prove a comment containing literal `-->` produces a still-valid single HTML comment.
- **Fenced code blocks are annotated at block level only:** place the marker **after the closing fence**, never inside the code (a `<!-- -->` inside a code block renders as literal text). Use the code block's `endOffset` (which is after the closing fence) — do not compute a position inside the fence.
- Blocks whose source already contains `<!-- -->` are handled by the same escaping rules — only the inserted marker is sanitized; the user's original source content is spliced verbatim and untouched.

## Work items

### 1. Generator core
- [ ] `sanitizeComment(text)` — neutralizes `--` / `-->` so the inserted comment can never close early; idempotent and tested.
- [ ] `generateReview(source, blocks, annotations)` — summary section + `---` + spliced original, numbering in source order, orphans in their own subsection, markers inserted at `endOffset` (after closing fence for `code`).
- [ ] `writeReview(...)` — compute the output path and write the file; return the path; surface write errors (do not swallow).

### 2. Tests
- [ ] Source fidelity: a doc with a GFM table + mixed bullets round-trips **byte-for-byte** except for the inserted markers (assert the original substring between markers is untouched).
- [ ] Numbering: summary `[N]` matches the inline `[N]` for the same annotation, in source order.
- [ ] Code block: marker lands **after** the closing ``` fence, never between the fences.
- [ ] Encoding: a comment containing `-->` yields exactly one valid HTML comment (no early termination, document not corrupted).
- [ ] Orphans: an `"orphaned"` annotation appears in the "Unresolved / orphaned" subsection and produces **no** inline marker.
- [ ] Output matches the README sample structure for the sample input (summary heading, total count, separator comment line).

## Acceptance criteria

- [ ] (a) `bun test src/review/generator.test.ts` is green.
- [ ] (b) `bun run typecheck` clean.
- [ ] (c) `rg "remark-stringify" src` returns nothing — the generator never re-serializes.
- [ ] (d) Given the README's sample document + 3 annotations, the generated string contains the summary section, the `---` separator, and the three `<!-- Review: [1..3] ... -->` markers at the right blocks.

## When done

1. Verify acceptance list ticked.
2. `bun run typecheck && bun test`.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 4 row to `DONE`.
4. Commit. Move to [`05-http-server-and-api.md`](05-http-server-and-api.md).
