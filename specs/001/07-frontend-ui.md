# Phase 7 — Frontend UI (click-to-annotate)

**Status:** `TODO`
**Depends on:** Phase 5 (the API contract this UI talks to — hard dependency). Phase 6 (CLI) is sequenced before this phase **by choice, not by code coupling**: a working `bun run start <file>` lets you launch the real app and iterate the UI live in the browser, which the `impeccable` flow wants. If Phase 6 were somehow incomplete you could still serve the page via the server directly, but do the phases in order.
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 7. Do not pre-emptively open other phase files or re-read the root spec.

---

## ⚠️ DO NOT RUN THIS PHASE IN A SUBAGENT — IMPLEMENT IT IN YOUR MAIN CONTEXT

**This phase is the explicit exception to the orchestrator→worker rule used by every other phase in this spec.** Every other phase is delegated to a cold-start `worker` subagent. **Phase 7 is NOT.** Implement it yourself, in the main conversation, because:

- This phase invokes the **`impeccable` skill** (the operator's `/impeccable craft` flow). That skill **asks the operator clarifying questions** (about visual direction, component choices, motion, edge cases) **before it generates any visuals**.
- A subagent **cannot relay those interactive questions** back to the operator. If you delegate this phase, the questions are answered by the agent's guesses (or skipped), producing off-brand UI and defeating the entire point of using `impeccable`.

**So: handle Phase 7 directly.** Load the `impeccable` skill in your main context, answer-loop with the operator, and only then write `page.html` / `app.js` / `public/` assets. Do **not** `Agent`/spawn a worker for any part of the visual build.

---

## Before you start (non-optional)

1. **Load the `impeccable` skill in `craft` mode** (the operator's `/impeccable craft`). Let it ask its questions and wait for the operator's answers before writing component markup/styles. Do not pre-empt its questions with assumptions.
2. **Read the repo-root [`../../DESIGN.md`](../../DESIGN.md)** in full — it is the design system ("The Annotated Terminal") this UI must honor: tokens (colors, typography), named rules, and do's/don'ts. Also skim [`../../PRODUCT.md`](../../PRODUCT.md) for brand personality.
3. Match the existing page scaffold from Phase 5 (the placeholder `page.html`/`app.js` you are about to replace) and the server's API contract below — keep the route/field names identical.

The first work-item checkbox below is literally "load `impeccable` + read `DESIGN.md`." Do not write a single component before both are done.

---

## Files touched

- `src/frontend/page.html` — **replace** the Phase 5 placeholder with the crafted page template (server injects rendered blocks at the same placeholder marker)
- `src/frontend/app.js` — **replace** the placeholder harness with the real vanilla-JS interaction layer (click→modal→save, overlay, sidebar)
- `public/` — fonts/css/favicon as needed; keep it static, no bundler
- `public/fonts/` — **self-hosted** SUSE + SUSE Mono webfonts (woff2). See "Fonts" below.
- (Do **not** change the server routes. If the page-injection placeholder or a static route needs adjusting, keep the contract identical and note it.)

## Pre-flight check

```sh
ls src/frontend/page.html src/frontend/app.js public 2>/dev/null
rg -n "data-block-id|/api/(markdown|annotations|done)" src/frontend/app.js 2>/dev/null
# Run the app live to iterate (impeccable wants live browser iteration):
# bun run start path/to/sample.md         # opens the browser; iterate against it
```

## Design system constraints (from `DESIGN.md` — read it fully, this is a summary)

> Do not treat this summary as a substitute for reading `DESIGN.md`. `impeccable` + `DESIGN.md` together drive the visual decisions; this section only fixes the non-negotiable product constraints.

- **"The Annotated Terminal."** Dark surface by default (`surface oklch(0.08 0 0)`, `surface-raised oklch(0.14 0 0)`). Content-first: the markdown document is the hero; chrome frames, never competes.
- **Restrained accent.** Violet/amethyst (`violet-twilight oklch(0.481 0.194 289.55)`, `violet-tint oklch(0.72 0.14 295)`) appears **only** on annotated blocks, primary actions, and active states — ≤10% of any screen. Scarcity is the point.
- **Inverted type pairing.** SUSE Mono for **document headings (h1–h3) only**; SUSE geometric sans for **all UI chrome** (toolbar, labels, buttons, modal text, metadata). Never put SUSE Mono on UI labels/buttons.
- **Flat by default.** Depth via tonal layering (surface vs surface-raised), not shadows. Shadows respond to state (modal backdrop, focus) only.
- **Motion conveys state, never decorates.** Fast transitions (150–250ms). Honor `prefers-reduced-motion`.
- **Don'ts:** no SaaS card grids / gradient text / cream backgrounds / feature walls; no warm-red/orange "terminal" palette; **no `border-left`/`border-right` colored accent stripes on blocks** — use background tints / the accent overlay for annotated blocks instead. No unreadable muted text (≥4.5:1).
- **No frontend build step / no framework / no Vite.** Inline vanilla JS + optional Web Components, served by Bun. (If bundling ever becomes necessary, `Bun.build` only.)

### Fonts (resolved decision — self-host, do NOT use a CDN)

`mdr` is a **localhost tool that reviews local files and must work offline** — a Google Fonts / CDN `<link>` would make the UI degrade (or hang on first paint) with no network. So **self-host** SUSE and SUSE Mono:

- Vendor the woff2 files into `public/fonts/` and declare them with `@font-face` (SUSE and SUSE Mono are open-source under the SIL Open Font License — OFL — so bundling is permitted; keep the license file alongside them). Add a static route or serve `public/` so the browser can fetch them.
- Always declare a graceful fallback stack (already in `DESIGN.md`'s tokens): mono → `SUSE Mono, ui-monospace, SFMono-Regular, monospace`; sans → `SUSE, Inter, system-ui, sans-serif`. The UI must remain legible if a font file is missing.
- Use `font-display: swap` so text paints immediately. No layout shift beyond the swap.
- If obtaining the exact SUSE woff2 files is blocked during implementation, ship the system-fallback stack and flag it to the operator — **never** add a runtime CDN dependency to work around it.

## API contract this UI talks to (wire-exact — must match Phase 5)

The frontend uses these routes and the **exact** JSON field casing from `src/shared/types.ts` (no casing translation layer):

| Method | Endpoint | Body it sends | What it reads back |
| --- | --- | --- | --- |
| `GET` | `/api/markdown` | — | `{ source, blocks: BlockNode[] }` (`blocks[].id`, `.anchor`, `.type`, `.text`, `.lineRange`, `.html`) |
| `GET` | `/api/annotations` | — | `{ annotations: Annotation[] }` (each with `.status` ∈ `ok`/`stale`/`orphaned`) |
| `POST` | `/api/annotations` | `{ anchor, blockType, blockText, blockLineRange, comment, id? }` | `{ annotation: Annotation }` |
| `DELETE` | `/api/annotations/:id` | — | `{ ok: true }` / `404` |
| `POST` | `/api/done` | empty | `{ ok: true, path }` then server stops; or `{ ok: false, error }` (server stays up) |

`Annotation` fields the UI reads/writes: `id`, `anchor{ blockType, textHash, siblingOrdinal }`, `blockType`, `blockText`, `blockLineRange`, `comment`, `status`, `createdAt`, `updatedAt`. Match casing exactly.

## UI specification (interaction model)

- **Document view.** The server injects rendered blocks (each carries `data-block-id` and `data-anchor`). Render them as the dominant content column (max ~65–75ch line length for prose). Headings use SUSE Mono; everything else SUSE sans.
- **Click-to-annotate.** Clicking any block with a `data-block-id` opens the **annotation modal** for that block: add / edit / delete a comment. On save → `POST /api/annotations` (include `id` when editing). On delete → `DELETE /api/annotations/:id`.
- **Highlight overlay.** Annotated blocks get a subtle violet/amethyst **background tint / overlay** (NOT a left/right border stripe) so the user can track progress at a glance. The annotation count shows in the toolbar.
- **Toolbar.** Fixed top bar: file name, live annotation count, **Done** button. Done → `POST /api/done`; on `{ ok: true }` show a success/closing state (the server is shutting down — the page will lose its backend, so show a clear "review written to `<path>` — you can close this tab" terminal state). On `{ ok: false, error }` keep the UI up and surface the error (the server stayed alive; retry is possible).
- **Stale + orphan handling.** `status: "stale"` blocks show a warning affordance (the content changed since the comment was written). `status: "orphaned"` annotations have no block to attach to — surface them in a **sidebar** list where the user can read the original context and **discard or edit** them (drag-to-reattach is a non-goal; do not build it). Orphans must never be silently hidden.
- **Empty state.** A document with zero annotations should make the "click a block to comment" affordance discoverable without clutter.
- **Accessibility (best-effort, per `PRODUCT.md`).** Keyboard-operable modal (focus trap, Esc to close, Enter/save), visible focus rings, `prefers-reduced-motion` respected. No formal WCAG target, but muted text ≥4.5:1.

## Work items

Tick each as you complete it. Iterate live in the browser (`bun run start <sample.md>`).

### 1. Setup (do first — gate for everything below)
- [ ] **Load the `impeccable` skill (`craft`) and answer its operator questions** before writing any markup/styles.
- [ ] **Read `DESIGN.md` in full** (and skim `PRODUCT.md`).

### 2. Page shell & document render
- [ ] `page.html` crafted shell: dark surface, toolbar (file name + count + Done), document column, sidebar region — honoring the design tokens. Keep the server's block-injection placeholder intact.
- [ ] **Self-host** SUSE / SUSE Mono woff2 in `public/fonts/` with `@font-face` + `font-display: swap` + the fallback stacks (no CDN); mono on document headings only, sans on all chrome.

### 3. Interaction layer (`app.js`)
- [ ] Load `/api/markdown` + `/api/annotations` on boot; paint existing annotations' overlays + count.
- [ ] Click block → modal (add/edit/delete); save → `POST /api/annotations` (with `id` on edit); delete → `DELETE /api/annotations/:id`; refresh overlay + count.
- [ ] Annotated-block overlay = background tint/accent overlay (no border stripes).
- [ ] Stale warning affordance; orphan sidebar (read context, discard/edit — no reattach).
- [ ] Done → `POST /api/done`; success terminal state showing the written `path`; failure keeps UI up and shows `error`.
- [ ] Modal a11y: focus trap, Esc, Enter-to-save, focus rings; `prefers-reduced-motion`.

### 4. Verify live
- [ ] Run `bun run start` on a sample doc with headings, a list, a GFM table, and a fenced code block; annotate one of each, edit one, delete one, hit Done, confirm `_reviewed.md` is written and the page shows the terminal "written to <path>" state.

## Acceptance criteria

- [ ] (a) `bun run typecheck` clean; the app launches via `bun run start <file>` and renders the document dark-themed with SUSE Mono headings.
- [ ] (b) Clicking a block opens the modal; saving creates an annotation (visible in the session dir) and tints the block; the toolbar count updates.
- [ ] (c) Editing and deleting an annotation work and update the overlay/count.
- [ ] (d) An orphaned annotation appears in the sidebar (not silently dropped); a stale one shows a warning.
- [ ] (e) Done writes `_reviewed.md` and shows the success terminal state; a forced server-side failure leaves the UI up showing the error.
- [ ] (f) No design-system violations: no border-stripe accents on blocks, no SUSE Mono on UI chrome, no SaaS card-grid/gradient/cream patterns, accent ≤ ~10% of screen.
- [ ] (g) Modal is keyboard-operable (Esc closes, focus trapped) and motion respects `prefers-reduced-motion`.

## When done

1. Verify the acceptance list is fully ticked **and** the operator is satisfied with the `impeccable` result.
2. `bun run typecheck`; run the app once more end-to-end.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 7 row to `DONE`.
4. Commit on the branch. Move to [`08-documentation.md`](08-documentation.md).
