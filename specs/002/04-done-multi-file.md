# Phase 4 — Review modal and server lifecycle

**Status:** `TODO`
**Depends on:** Phase 3 (Frontend multi-file view)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 4. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `specs/002-multi-file-review` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/002/04-done-multi-file.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** Phase 1 added per-file state, writes `<name>.mdr` on every annotation save/delete, and each `.mdr` already begins with the `AGENT_PROTOCOL_BLOCK` (the authoritative apply instructions). Phase 3 added the file zone and per-file view. The server is `Bun.serve({ async fetch(req) {...} })` in `src/server/index.ts`; it shuts down via `bunServer.stop(true)` + releasing locks + resolving a `stopped` promise (`resolveStopped()`).
- **Definition of done:** all Work items + Acceptance criteria ticked; gates green (`bun run typecheck`, `bun test`; `curl` smoke tests for `/api/reviewed-files` and `/api/ping`); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit.

---

## What changes

Old Done flow: `POST /api/done` generates the reviewed file, the server shuts down, and the frontend shows the terminal modal. New flow:

1. `.mdr` files are already current (written on every annotation — Phase 1).
2. Done shows a modal listing all annotated files and their `.mdr` paths.
3. "Copy prompt" lists the `.mdr` paths and **defers to the AGENT PROTOCOL block** inside each file — it does **not** restate apply instructions.
4. The server stays alive — heartbeat handles shutdown.

> **Critical (AGENT PROTOCOL integration):** every `.mdr` already contains, as its first bytes, the `AGENT_PROTOCOL_BLOCK` defined in `src/review/generator.ts`. That block is the single authoritative source for *how* to apply a review (its APPLY/ASK triage, BATCH handling for multiple files, PRESERVE/REPORT rules). The copy-prompt MUST be a thin pointer to the `.mdr` files and must NOT duplicate or contradict it. In particular, do **not** reintroduce the old "When uncertain: do not guess, ask the user" wording — the protocol's policy is the opposite ("default to APPLY; ASK is the rare exception"), and duplicating instructions invites drift.

## Files touched

- `src/server/index.ts` — add `GET /api/reviewed-files`, `GET /api/ping`, heartbeat timer; keep `POST /api/done` working but non-terminating.
- `src/frontend/app.js` — Done handler, `reviewPrompt`, terminal modal, heartbeat ping.
- `src/frontend/page.html` — terminal modal markup/CSS for the file list.

## Pre-flight check (resume-after-compaction hint)

```sh
# Real server shape + shutdown primitives you must reuse (NOT addListener/res())
rg -n "Bun.serve|async fetch|new URL\(req.url\)|bunServer.stop|session.release|resolveStopped|/api/done" src/server/index.ts
# Current copy-prompt — confirm it is already the thin pointer (PR #4), then generalize to many files
rg -n "reviewPrompt|AGENT PROTOCOL|_reviewed|\.mdr|terminal|elBtnDone" src/frontend/app.js
rg -n "reviewedFilePath|writeReview|\.mdr" src/review/generator.ts
bun run typecheck && bun test
```

If a step's outputs show the code already exists, that step is done — skip it and re-run its tests to confirm.

## API contract

### GET /api/reviewed-files

Returns the files that currently have a `.mdr` (i.e. files with ≥1 annotation):

```
GET /api/reviewed-files
→ { files: [ { key, reviewedPath, sourcePath, annotationCount }, ... ] }
```

Server-side:
- Iterate `fileStore.list()`.
- For each entry, call that entry's own `session.list()`; include entries with `annotationCount > 0`.
- `reviewedPath` = the same `.mdr` mapping used in Phase 1 (`sourcePath.replace(/\.md$/i, ".mdr")`); `sourcePath` = the entry's absolute `filePath`.
- Do not include unrelated files discovered elsewhere in the tmpDir.

### GET /api/ping (heartbeat)

```
GET /api/ping → { ok: true }
```
Records the time of the request (see lifecycle below). It is the only signal that the browser is still open.

### POST /api/done (kept, but non-terminating)

- Regenerate the entry file's `.mdr` if needed and return `{ ok: true, path }`.
- **Do NOT shut the server down.** Shutdown is owned by the heartbeat (or an explicit CLI signal).
- The frontend prefers `GET /api/reviewed-files` for both single- and multi-file Done; `POST /api/done` remains only for API backward-compat.

## Prompt format (thin pointer — defer to the AGENT PROTOCOL block)

`reviewPrompt(reviewedFiles, relatedFiles)` returns a short prompt that **lists the `.mdr` paths and points at the protocol block**, then lists the **related cluster files** (session members without annotations / no `.mdr`) so the agent checks them for repercussions. It works for one or many files (the block's own `BATCH` section already covers multiple files). Keep it close to the existing single-file pointer that PR #4 shipped; just generalize the path list and append the related-files nudge.

- `reviewedFiles`: `[{ reviewedPath, sourcePath, annotationCount }]` from `GET /api/reviewed-files` — the files to APPLY.
- `relatedFiles`: the source paths from `GET /api/session-files` that are **not** in `reviewedFiles` — the cluster context to CHECK. Omit the whole "Related files" block when this list is empty (e.g. single-file, no other session members).

Reference shape (single or multi):

```
Apply the markdown review(s):
1. /abs/specs/001.mdr (3 annotations)
2. /abs/specs/002.mdr (1 annotation)
3. /abs/docs/architecture.mdr (2 annotations)

Each .mdr file begins with an "AGENT PROTOCOL" comment block — follow it as authoritative.
In short: the source file is the .mdr path with the extension changed back to .md; default to
applying edits, only stopping to ask on genuine forks or costly/irreversible guesses (batch all
questions into one); strip the protocol block, the summary, and all review markers from the
source; then delete each .mdr once its review is applied; report what changed per file.

Related files in this cluster (no annotations of their own — do NOT edit them blindly, but
check whether your edits above create inconsistencies or stale references in them, and flag any):
- /abs/specs/003.md
- /abs/docs/glossary.md
```

```js
function reviewPrompt(reviewedFiles, relatedFiles) {
  // List every reviewedPath, then defer to the AGENT PROTOCOL block inside each .mdr.
  // Then, if relatedFiles is non-empty, append the "Related files in this cluster" block.
  // Do NOT inline apply instructions or "do not guess" — the block owns the apply policy.
}
```

> Do **not** branch into a long "single-file" prompt variant. The previous spec draft had a verbose per-file instruction list with "When uncertain: do not guess" — that is removed because it contradicts the protocol block now embedded in every `.mdr`. The related-files block is a *cluster-awareness nudge*, not apply instructions — it never tells the agent to edit those files, only to check them for drift.

## UI specification — review terminal modal

Reuse the existing terminal modal; render a file list instead of a single path.

```html
<div id="terminal">
  <div id="terminal-title">Review Ready</div>
  <div id="terminal-msg"></div>
  <div id="terminal-file-list"></div>
  <div id="terminal-error" class="terminal-error"></div>
  <div class="terminal-actions">
    <button id="terminal-copy-prompt">Copy prompt</button>
    <button id="terminal-dismiss">Dismiss</button>
  </div>
</div>
```

```css
.terminal-file-list { margin: 16px 0; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.terminal-file-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 13px; font-family: var(--font-mono); }
.terminal-file-item:not(:last-child) { border-bottom: 1px solid var(--border); }
.terminal-file-path { color: var(--text-primary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.terminal-file-count { flex-shrink: 0; margin-left: 12px; color: var(--text-muted); font-size: 12px; }
```

`showReviewTerminal(files)`: set the title; set a summary message (e.g. "N files with M total annotations"); render the file list with `.mdr` paths + counts; build the prompt via `reviewPrompt(files)` and store it for the copy button; show the modal.

Done handler (UI-only — server stays alive):

```js
elBtnDone.addEventListener('click', async function () {
  elBtnDone.disabled = true;
  setStatus('loading review...', 'warn');
  try {
    var reviewed = (await api('/api/reviewed-files')).files;          // files to APPLY
    var session  = (await api('/api/session-files')).files;          // whole cluster
    if (reviewed.length > 0) {
      // relatedFiles = session members whose source isn't among the reviewed files
      var reviewedKeys = new Set(reviewed.map(function (f) { return f.key; }));
      var related = session.filter(function (f) { return !reviewedKeys.has(f.key); });
      showReviewTerminal(reviewed, related);
      setStatus('review ready', 'ok');
    } else {
      setStatus('no annotations to review', 'warn');
    }
  } catch (err) {
    showTerminalError(err.message);
  } finally {
    elBtnDone.disabled = false;   // server stays alive in all cases
  }
});
```

> `showReviewTerminal(reviewedFiles, relatedFiles)` renders the reviewed list (with counts) and builds the prompt via `reviewPrompt(reviewedFiles, relatedFiles)`. The related list may also be shown in the modal (muted) so the user sees the cluster context that will be in the prompt.

## Server lifecycle — heartbeat (match the real Bun server)

The current server is `Bun.serve({ async fetch(req) { const url = new URL(req.url); ... } })` and shuts down by calling `bunServer.stop(true)`, releasing locks, and resolving the `stopped` promise. Add the heartbeat **inside that existing model** — do not invent an `addListener("request", …)`/`res()` API (the previous draft's pseudocode was wrong).

```ts
// In startServer(), alongside the existing `resolveStopped`/`stopped` setup:
let lastPing: number | null = null;   // null until the browser's first ping

// Inside the existing `async fetch(req)` router, add:
//   if (pathname === "/api/ping" && req.method === "GET") {
//     lastPing = Date.now();
//     return json({ ok: true });
//   }

const heartbeat = setInterval(async () => {
  // Only arm the clock AFTER the first ping (don't shut down before the page JS loads).
  if (lastPing !== null && Date.now() - lastPing > 15000) {
    clearInterval(heartbeat);
    bunServer.stop(true);
    await fileStore.releaseAll();   // release every per-file lock (Phase 1)
    resolveStopped();
  }
}, 5000);
```

- Clear `heartbeat` on **every** shutdown path (the existing `stop()` and `POST /api/done` paths too) so the interval can't fire after shutdown.
- `.mdr` files are already current from Phase 1, so heartbeat shutdown does **not** need to generate anything. (If you want a belt-and-suspenders regenerate, it is optional and must reuse `regenerateReviewedFile` from Phase 1 — never a second generator.)

Frontend heartbeat:

```js
// In app.js init:
setInterval(function () { api('/api/ping').catch(function () { /* server gone — ignore */ }); }, 5000);
```

## Work items

Tick each box as you complete it. Commit after each logical group.

- [ ] Add `GET /api/reviewed-files` (iterates `fileStore`, `.mdr` paths, counts).
- [ ] Add `GET /api/ping` inside the existing `fetch` router; track `lastPing`.
- [ ] Add the heartbeat `setInterval`; shut down via `bunServer.stop(true)` + `fileStore.releaseAll()` + `resolveStopped()`; clear it on all shutdown paths.
- [ ] Make `POST /api/done` non-terminating (regenerate entry `.mdr`, return path, no shutdown).
- [ ] Rewrite `reviewPrompt(reviewedFiles, relatedFiles)` as a thin pointer listing `.mdr` paths and deferring to the AGENT PROTOCOL block, then append the "Related files in this cluster" block (omit when `relatedFiles` is empty); remove any inline "do not guess"/instruction-list wording.
- [ ] Update the Done handler to fetch both `/api/reviewed-files` and `/api/session-files`, derive `related = session − reviewed`, and show the modal without shutting down.
- [ ] Update the terminal modal markup/CSS to render the file list.
- [ ] Add the frontend heartbeat ping (every 5s).

## Acceptance criteria

- [ ] `GET /api/reviewed-files` returns files with `.mdr` paths and annotation counts.
- [ ] The copy-prompt lists `.mdr` paths and explicitly defers to each file's AGENT PROTOCOL block; it contains no inline apply-instruction list and no "do not guess" wording.
- [ ] The single-file copy-prompt and multi-file copy-prompt use the same thin-pointer format.
- [ ] When the session has members beyond the annotated files, the prompt appends a "Related files in this cluster" block (source paths only, framed as check-for-repercussions, not edit); when there are none, the block is omitted.
- [ ] The terminal modal shows a multi-file summary with the file list.
- [ ] Done does NOT trigger server shutdown in single- or multi-file mode.
- [ ] Frontend pings `/api/ping` every 5s.
- [ ] The server shuts down after 15s of no pings, but only after at least one successful ping was received; the heartbeat interval is cleared on every shutdown path.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## When done

1. Verify the acceptance criteria above are fully ticked.
2. `bun run typecheck && bun test`, plus `curl` smoke tests for `/api/reviewed-files` and `/api/ping`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 4 to `DONE` (same commit).
5. Commit on the spec branch. Move to [`05-session-persistence.md`](05-session-persistence.md).
