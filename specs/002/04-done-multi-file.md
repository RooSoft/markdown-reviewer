# Phase 4 — Done: multi-file file list, prompt with reviewed paths, no shutdown

**Status:** `TODO`
**Depends on:** Phase 3 (Frontend multi-file view)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

The current Done flow:
1. Calls `POST /api/done`
2. Server generates `_reviewed.md` for the single file
3. Server shuts down
4. Frontend shows the "terminal" modal with file path + copy prompt button

For multi-file:
1. Generate `_reviewed.md` for ALL annotated files
2. Show a file list in the modal
3. "Copy prompt" lists all `_reviewed.md` paths (agent reads them)
4. Server does NOT shut down — user quits with Ctrl-C

## Implementation

### 1. New server route: POST /api/done-all

```
POST /api/done-all
→ { ok: true, files: [{ key, reviewedPath, annotationCount }, ...] }
```

Server-side:
- Iterate all files in `FileStore`
- For each file with annotations:
  - Load annotations via `session.list()`
  - Relocate against current blocks
  - Generate `_reviewed.md` via existing `writeReview()`
- Return file list with paths and counts
- Do NOT shut down the server

### 2. Prompt format

Update the prompt generator in `app.js`. For single-file (current behavior):

```
You are applying a completed markdown review.

Read the reviewed file:
specs/001_reviewed.md

Likely original source file:
specs/001.md

The reviewed file contains a summary section, then the original markdown with inline `<!-- Review: [N] ... -->` markers. Treat each numbered review comment as an instruction for the corresponding part of the source document.

Your task:
1. Locate the original source markdown file.
2. Apply all clear review comments directly to the original source file.
3. Preserve the author's formatting, structure, links, code fences, frontmatter, and wording unless a review comment asks for a change.
4. Remove review markers from the final source. Do not copy the summary section into the source file.
5. After editing, report what changed and list any review comments you could not apply.

When uncertain:
Do not guess. Ask the user a short numbered questionnaire with specific options or yes/no questions. Include only the questions needed to apply the review correctly. Wait for the user's answers before making uncertain edits.
```

For multi-file — same structure, lists each reviewed file:

```
You are applying a completed markdown review across multiple files.

Reviewed files:
1. specs/001_reviewed.md (3 annotations) → source: specs/001.md
2. specs/002_reviewed.md (1 annotation) → source: specs/002.md
3. docs/architecture_reviewed.md (2 annotations) → source: docs/architecture.md

For each reviewed file:
- Read the reviewed file (contains summary + inline `<!-- Review: [N] ... -->` markers)
- Locate the original source file (same name without `_reviewed`)
- Apply all clear review comments to the source
- Preserve formatting, structure, links, code fences, frontmatter
- Remove review markers from the final source. Do not copy summary sections.

When uncertain:
Do not guess. Ask the user a short numbered questionnaire. Wait for answers before making uncertain edits.

After editing all files, report what changed in each and list any comments you could not apply.
```

### 3. reviewPrompt function update

```js
function reviewPrompt(files) {
  // files: [{ reviewedPath, sourcePath, annotationCount }]
  if (files.length === 1) {
    // Single file — use current format
    return singleFilePrompt(files[0]);
  }
  // Multi-file — list all reviewed files
  return multiFilePrompt(files);
}
```

### 4. Update Done button handler

Change `elBtnDone` click handler to call `/api/done-all`:

```js
elBtnDone.addEventListener('click', function () {
  elBtnDone.disabled = true;
  setStatus('generating review...', 'warn');

  api('/api/done-all', { method: 'POST' })
    .then(function (res) {
      if (res.ok) {
        showMultiFileTerminal(res.files);
        setStatus('review written', 'ok');
        elBtnDone.disabled = false;  // server stays alive
      }
    })
    .catch(function (err) {
      showTerminalError(err.message);
      elBtnDone.disabled = false;
    });
});
```

### 5. Multi-file terminal modal

Update the existing terminal modal:

```html
<div id="terminal">
  <div id="terminal-title">Review Complete</div>
  <div id="terminal-msg"></div>
  <div id="terminal-file-list"></div>
  <div id="terminal-error" class="terminal-error"></div>
  <div class="terminal-actions">
    <button id="terminal-copy-prompt">Copy prompt</button>
    <button id="terminal-dismiss">Dismiss</button>
  </div>
</div>
```

`showMultiFileTerminal(files)`:
- Set title: "Review Complete"
- Set message: summary (e.g., "Reviews generated for N files with M total annotations")
- Render file list with reviewed paths and annotation counts
- Generate prompt via `reviewPrompt(files)`, store for copy button
- Show modal

### 6. CSS for file list in terminal

```css
.terminal-file-list {
  margin: 16px 0;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.terminal-file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 13px;
  font-family: var(--font-mono);
}

.terminal-file-item:not(:last-child) {
  border-bottom: 1px solid var(--border);
}

.terminal-file-path {
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-file-count {
  flex-shrink: 0;
  margin-left: 12px;
  color: var(--text-muted);
  font-size: 12px;
}
```

### 7. Remove server shutdown from Done

In `src/server/index.ts`, remove the shutdown trigger from `POST /api/done`:

```ts
// REMOVE this:
setTimeout(() => {
  bunServer.stop(true);
  session.release();
  resolveStopped();
}, 0);
```

Server only shuts down on SIGINT/SIGTERM (Ctrl-C).

### 8. Backward compatibility

Keep `POST /api/done` for single-file (generates `_reviewed.md` for entry file, no shutdown). Multi-file uses `POST /api/done-all`.

## Acceptance criteria

- [ ] `POST /api/done-all` generates `_reviewed.md` for all annotated files
- [ ] Response includes file list with reviewed paths and annotation counts
- [ ] Prompt lists reviewed file paths (agent reads them), not inline summaries
- [ ] Single-file prompt format unchanged (backward compat)
- [ ] Terminal modal shows multi-file summary with file list
- [ ] "Copy prompt" copies the correct prompt format
- [ ] Server does NOT shut down after Done
- [ ] User can continue editing after Done
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/server/index.ts` — add `POST /api/done-all`, remove shutdown from `POST /api/done`
- `src/review/generator.ts` — no changes (already generates per-file)
- `src/frontend/app.js` — update Done handler, prompt format, terminal modal
- `src/frontend/page.html` — terminal modal CSS updates
