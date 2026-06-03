# Phase 1 — Project scaffold & shared types

**Status:** `TODO`
**Depends on:** —
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 1. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (create it from `main` if it does not exist; commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals. Do **not** read the other phase files.
- **Prior phases landed:** none — this is the first phase.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun install` succeeds and `bun run typecheck` is clean; committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit.

---

## Files touched

- `package.json` — project manifest, `"type": "module"`, scripts, deps
- `tsconfig.json` — ESM/bundler config for the remark v11 stack
- `bunfig.toml` — Bun config
- `.gitignore` — ignore `node_modules`, `dist`, scratch reviewed files
- `src/shared/types.ts` — shared types used by every other phase
- `src/shared/index.ts` — (optional) barrel re-export, only if it stays trivial

## Pre-flight check (resume-after-compaction hint)

```sh
git branch --show-current                 # expect spec/001-markdown-reviewer
ls package.json tsconfig.json bunfig.toml 2>/dev/null
rg -n "interface (BlockAnchor|BlockNode|Annotation)" src/shared/types.ts 2>/dev/null
bun run typecheck 2>/dev/null
```

If `types.ts` already defines all three interfaces and `bun run typecheck` is clean, this phase is essentially done — just confirm scripts/deps and tick the boxes.

## Data model (authoritative — every later phase imports from here)

Define these in `src/shared/types.ts`. Use the **exact** field names and casing below (they are the persisted JSON wire format).

```typescript
// How an annotation re-finds its block after a reparse. Persisted with each annotation.
export interface BlockAnchor {
  blockType: string;       // mdast node type: "heading" | "paragraph" | "listItem" | "tableCell" | "code" | "blockquote" | ...
  textHash: string;        // short hash of the block's OWN normalized inline text (not nested children)
  siblingOrdinal: number;  // index within the IMMEDIATE parent container (the value unist-util-visit hands the visitor)
}

// A renderable, clickable block produced per-parse by the markdown service.
export interface BlockNode {
  id: string;                  // ephemeral per-render id, exposed to the DOM as data-block-id (e.g. "b0", "b1")
  anchor: BlockAnchor;         // stable, persisted with the annotation
  type: string;                // same value as anchor.blockType, denormalized for convenience
  text: string;                // extracted block text (own inline text)
  lineRange: [number, number]; // ADVISORY ONLY — for display, never trusted for re-location
  html: string;                // server-rendered HTML for this block (already carries data-block-id)
}

export type AnnotationStatus = "ok" | "stale" | "orphaned";

// The persisted annotation (one JSON file each).
export interface Annotation {
  id: string;                       // short hash, also the JSON filename (without .json)
  anchor: BlockAnchor;              // how we re-find the block on resume
  blockType: string;                // denormalized for the review summary
  blockText: string;                // original text snapshot (review context + stale detection)
  blockLineRange: [number, number]; // advisory snapshot at creation time
  comment: string;                  // user's annotation text
  status: AnnotationStatus;         // re-location result on last load
  createdAt: number;                // epoch ms
  updatedAt: number;                // epoch ms
}
```

> Do not add `type`-of-annotation, multi-file, or diff fields — those are explicit non-goals for spec 001.

## package.json contract

- `"name": "markdown-reviewer"`, `"type": "module"`, a `"bin"` mapping `"mdr"` → `"src/cli/index.ts"` (the CLI is implemented in Phase 6; declaring the bin now is fine — it just won't run until then).
- **Scripts:**
  - `"typecheck": "tsc --noEmit"`
  - `"start": "bun run src/cli/index.ts"`
  - `"dev": "bun --watch run src/cli/index.ts"`
  - `"test": "bun test"`
- **Dependencies** (the verified unified/remark v11 stack — ESM-only, Bun runs it natively):

  | Package | Range | Why |
  | --- | --- | --- |
  | `unified` | `^11` | processor pipeline |
  | `remark-parse` | `^11` | markdown → mdast |
  | `remark-gfm` | `^4` | tables / strikethrough / task lists (required — plain CommonMark won't parse tables) |
  | `remark-frontmatter` | `^5` | surfaces YAML/TOML as a positioned node so we can skip it |
  | `remark-rehype` | `^11` | mdast → hast |
  | `hast-util-to-html` | `^9` | hast → HTML string |
  | `mdast-util-to-string` | `^4` | clean text extraction for the anchor hash |
  | `unist-util-visit` | `^5` | tree walking; `(node, index, parent)` gives `siblingOrdinal` |

  > `remark-gfm`, `remark-rehype`, `remark-frontmatter` are **separate** npm packages (the remark monorepo only ships `remark`, `remark-parse`, `remark-stringify`, `remark-cli`). **Do NOT add `remark-stringify`** — the generator splices into source and never re-serializes.

- **devDependencies:** `@types/mdast` `^4`, `@types/bun` (or `bun-types`) for Bun globals, `typescript` `^5`.

## tsconfig.json contract

Required because the stack is ESM-only and resolves via `exports` maps:

```jsonc
{
  "compilerOptions": {
    "module": "esnext",            // or "preserve"
    "moduleResolution": "bundler", // resolves the packages' "exports" field correctly
    "target": "esnext",
    "types": ["bun-types"],        // Bun globals (Bun.serve, etc.)
    "verbatimModuleSyntax": true,  // keep import/export as-authored
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

Import bare packages with **extensionless** specifiers; import local files with the extension Bun expects for your setup (be consistent across the repo). Do **not** expect `require()` to work for any remark package.

## bunfig.toml contract

A minimal `bunfig.toml` is enough for now (Bun works without it, but the README names it as part of the toolchain). At least set the test root so `bun test` finds co-located `*.test.ts` files. Keep it small — do not configure a bundler.

## Work items

Tick each box as you complete it. Commit after each logical group.

### 1. Repo skeleton
- [ ] Create/confirm branch `spec/001-markdown-reviewer`.
- [ ] Write `package.json` per the contract above (`"type": "module"`, scripts, deps, devDeps, `bin`).
- [ ] Write `tsconfig.json` per the contract above.
- [ ] Write `bunfig.toml` (minimal).
- [ ] Write `.gitignore` (`node_modules/`, `dist/`, `*_reviewed.md` scratch files if any, OS cruft).
- [ ] Create the empty directory layout the later phases expect: `src/cli/`, `src/server/`, `src/frontend/`, `src/review/`, `src/shared/`, `public/`.

### 2. Shared types
- [ ] Implement `src/shared/types.ts` with `BlockAnchor`, `BlockNode`, `AnnotationStatus`, `Annotation` exactly as specified.

### 3. Install & verify
- [ ] `bun install` — resolves all packages with no peer/ESM errors.
- [ ] `bun run typecheck` — clean.

## Acceptance criteria

- [ ] (a) `bun install` completes successfully and produces `bun.lockb`.
- [ ] (b) `bun run typecheck` exits 0 with the types file present.
- [ ] (c) `rg "remark-stringify" package.json` returns **nothing** (it must not be a dependency).
- [ ] (d) `package.json` declares `"type": "module"` and the four scripts (`typecheck`, `start`, `dev`, `test`).
- [ ] (e) `src/shared/types.ts` exports all four type names with the exact field casing in the Data model section.

## When done

1. Verify the acceptance list is fully ticked.
2. `bun run typecheck`.
3. Set this file's `Status:` to `DONE`.
4. Set the root spec **Phase dashboard** row for Phase 1 to `DONE`.
5. Commit on the spec branch. Move to [`02-parsing-and-anchoring.md`](02-parsing-and-anchoring.md).
