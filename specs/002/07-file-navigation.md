# Phase 7 — File navigation tree (craft)

**Status:** `TODO`
**Depends on:** Phase 3 (frontend wiring + functional zone), Phase 5 (session-files), Phase 6 (auto-discover / large clusters)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 7. Do not pre-emptively open other phase files or re-read the root spec.

---

> # ⚠ DO NOT DELEGATE THIS PHASE TO A SUBAGENT
> This is a hands-on visual craft phase. The operator wants to **watch, interrupt, and steer** it live.
> Implement it **directly in the main session**, iterating with the operator — **never** hand it to a
> `worker`/`Task` subagent the way the other phases are handed off. Run it as an `/impeccable craft`
> session. (This phase intentionally has **no** "Run this phase in a worker subagent" block.)

## How to run this phase

1. **Load the `impeccable` skill and run `/impeccable craft` on the Files navigation tree.** Work in the main session, presenting changes for the operator to react to.
2. **Read the repo-root [`DESIGN.md`](../../DESIGN.md)** and match the "Annotated Terminal" system: dark surfaces, **Restrained** color (violet/amethyst ≤10%), **Nunito for all UI chrome** (SUSE Mono is code-only — the Mono-For-Code rule; do **not** set file paths in mono), tonal elevation (no decorative shadows), 150–250ms ease-out motion with a `prefers-reduced-motion` fallback.
3. Match the existing sidebar in `src/frontend/page.html`: 320px width, `--radius: 6px`, the annotation `.sidebar-item` (subtle `--border`, hover → `--dark-amethyst` border) and the circular count badge (`.sidebar-item-number`: `--dark-amethyst` bg, `--violet-tint` text).
4. Verify in a real browser at multiple cluster sizes (2 files, ~6, 20+) before calling it done.

## Files touched

- `src/frontend/page.html` — the crafted Files-zone markup + CSS (replaces Phase 3's placeholder styling).
- `src/frontend/app.js` — `sortFilesForZone`, the crafted `renderFileZone`, keyboard handling, motion hooks. (Phase 3 left `renderFileZone` plain and the data wiring done; replace the render, keep the wiring.)

## Pre-flight check (resume-after-compaction hint)

```sh
# Phase 3 wiring this phase builds on (do not re-add it)
rg -n "renderFileZone|refreshSessionFiles|loadFile|switchToFile|activeFileKey|#file-zone|#file-list|data-file-key" src/frontend/app.js src/frontend/page.html
# Tokens + existing sidebar/badge styling to match
rg -n "--violet-twilight|--dark-amethyst|--violet-tint|--text-muted|--text-primary|--surface|--border|--radius|sidebar-item" src/frontend/page.html
bun run typecheck
```

## Design brief (confirmed)

**Chosen rendering: flat rows, one per file — muted directory prefix + bright basename + count pill.** Not a folder-row tree, not depth-indentation. This is how editor "quick open"/search lists present a curated file subset; it disambiguates same-named files (two `index.md`) without folder chrome.

```
FILES
──────────────────────
 readme.md            3      ← entry file, first
 docs/api.md          2
 docs/api/read.md     1
 docs/workflow.md     5
```

### Ordering (tree order, not insertion order)

1. The **entry file** (`isEntry === true`) is shown **first**.
2. All others sort by **code-unit comparison of the session `key`**. This is the explicit ordering rule. Because `.`(U+002E) < `/`(U+002F) < letters, it yields depth-first tree order for free: `X.md` precedes the subtree `X/…`, and you descend a branch before the next sibling. `..` parent entries therefore sort immediately after the entry and before ordinary alphabetic siblings.

```js
function sortFilesForZone(list) {
  // list: [{ key, fileName, annotationCount, isEntry }]
  return list.slice().sort(function (a, b) {
    if (a.isEntry !== b.isEntry) return a.isEntry ? -1 : 1;   // entry/root file first
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;        // code-unit key order = tree order
  });
}
```

**Oracle.** Navigating `readme.md → docs/workflow.md → ../shared.md → readme.md → docs/api.md → docs/api/read.md` (insertion order `readme.md, docs/workflow.md, ../shared.md, docs/api.md, docs/api/read.md`) MUST render as:

```
1. readme.md
2. ../shared.md
3. docs/api.md
4. docs/api/read.md
5. docs/workflow.md
```

### Row anatomy

Single line per file: `[dir-prefix muted][basename primary] ……… [count pill]`.

- **Label split:** render the key as a muted directory prefix (`docs/api/`) + a primary-color basename (`read.md`). Label sourced from the full `key`; `title={key}` for hover.
- **Truncation:** the basename and the count **never** truncate. Only the directory prefix truncates when the row is too narrow (leading/`…`-style ellipsis so the meaningful tail of the path survives). Most keys fit in 320px; this is the deep-path edge.
- **Count:** reuse the amethyst pill (`--dark-amethyst` bg, `--violet-tint` text). **Hidden when the count is 0.**
- **Typography:** Nunito. Basename ~13px; prefix slightly smaller/muted. No mono.

### States

- **Active** (`key === activeFileKey`): violet-tint background (`oklch(0.14 0.04 295)`) + full `1px solid var(--violet-twilight)` border + brightened basename. **No `border-left`/side stripe** (absolute ban).
- **Hover / focus-visible:** background `oklch(0.10 0.01 300)` / `2px solid var(--violet-twilight)` outline — consistent with `.sidebar-item`.
- **Zero annotations** (common with `--auto-discover`): no count pill; basename rendered in `--text-muted` to read as "mapped, not yet reviewed."
- **`..` parent entries:** ordinary row with a muted `../` prefix; no special icon.
- **Large cluster (20+ via `--auto-discover`):** `#file-list` scrolls inside the sidebar (`max-height` + `overflow-y:auto`, thin themed scrollbar); the "Files" title stays fixed above it. Annotation list above must remain reachable (overall sidebar layout stays usable).
- **Single file:** zone hidden entirely.

### Interaction & motion

- Rows are real `<button>`s (or `role="button"` + `tabindex="0"`). Click / Enter / Space → `loadFile(key)` (switches if cached, else lazy-fetches). Tab order top-to-bottom; arrow-key roving between rows is a nice-to-have, not required.
- Active state and hover transition ~150ms ease-out. New rows added (especially an `--auto-discover` batch) fade/slide in subtly — a short stagger is acceptable; keep it restrained.
- Full `@media (prefers-reduced-motion: reduce)` fallback (crossfade or instant).
- Counts update live after annotate/delete (Phase 3 already refreshes `files`); the crafted `renderFileZone` just re-renders sorted.

### Copy

Section title: **Files**. No empty-state copy (zone hidden at ≤1 file). Row `title` = full relative key.

## Work items

Tick each box as you complete it. Commit after each logical group.

- [ ] Run `/impeccable craft` in the **main session** (NOT a subagent); read `DESIGN.md`.
- [ ] Add `sortFilesForZone` (entry-first, code-unit key order) and render the zone through it; verify against the oracle above.
- [ ] Crafted row markup + CSS: muted dir prefix + primary basename + amethyst count pill (hidden at 0); directory-prefix-only truncation with `title={key}`.
- [ ] States: active (tint + full violet border, no side stripe), hover, focus-visible, zero-annotation muted, `..` prefix.
- [ ] Large-cluster scroll: `#file-list` scrolls within the sidebar; title pinned.
- [ ] Keyboard: rows are buttons; Enter/Space activate; focus-visible ring. (Arrow roving optional.)
- [ ] Motion: ~150ms active/hover; subtle row entrance; `prefers-reduced-motion` fallback.
- [ ] Browser-verify at 2 / ~6 / 20+ files; confirm contrast (muted prefix ≥4.5:1) and no layout break.

## Acceptance criteria

- [ ] Files render in tree order (entry first, then code-unit key order) — matches the oracle exactly.
- [ ] Each row shows a muted directory prefix + primary basename; the basename and count never truncate (only the prefix does); `title` is the full key.
- [ ] Count pill matches the amethyst/violet-tint badge and is hidden when the count is 0; zero-annotation rows read as muted.
- [ ] Active row uses a background tint + full violet border (no side stripe); hover/focus match the existing sidebar.
- [ ] `..` parent entries display with a muted `../` prefix and sort just after the entry.
- [ ] With 20+ files the list scrolls within the sidebar without breaking layout; the title stays put.
- [ ] Keyboard reachable (Tab + Enter/Space) with a visible focus ring; reduced-motion honored.
- [ ] File paths use Nunito (no SUSE Mono); the surface is on-brand "Annotated Terminal."
- [ ] `bun run typecheck` passes; `bun test` passes.

## When done

1. Verify the acceptance criteria above are fully ticked (browser-verified at multiple cluster sizes).
2. `bun run typecheck && bun test`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 7 to `DONE` (same commit).
5. Commit on the spec branch. Move to [`08-docs-and-test.md`](08-docs-and-test.md).
