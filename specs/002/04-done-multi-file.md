# Phase 4 — Done: file list modal, prompt with reviewed paths

**Status:** `TODO`
**Depends on:** Phase 3 (Frontend multi-file view)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

The current Done flow:
1. Calls `POST /api/done`
2. Server generates `.r.md` for the single file
3. Server shuts down
4. Frontend shows the "terminal" modal with file path + copy prompt button

For multi-file:
1. `.r.md` files are already current (written on every annotation — Phase 1)
2. Done shows a modal listing all annotated files and their `.r.md` paths
3. "Copy prompt" lists all `.r.md` paths (agent reads them)
4. Server stays alive — heartbeat handles shutdown

## Implementation

### 1. New server route: GET /api/reviewed-files

Returns all files that have `.r.md` (i.e., files with annotations):

```
GET /api/reviewed-files
→ { files: [{ key, reviewedPath, sourcePath, annotationCount }, ...] }
```

Server-side:
- Iterate all files in `FileStore`
- For each file, check if `.r.md` exists (or has annotations)
- Return list with paths and counts

### 2. Prompt format

For single-file (current behavior):

```
You are applying a completed markdown review.

Read the reviewed file:
specs/001.r.md

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
1. specs/001.r.md (3 annotations) → source: specs/001.md
2. specs/002.r.md (1 annotation) → source: specs/002.md
3. docs/architecture.r.md (2 annotations) → source: docs/architecture.md

For each reviewed file:
- Read the reviewed file (contains summary + inline `<!-- Review: [N] ... -->` markers)
- Locate the original source file (same name with `.r` removed)
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

Done is now a UI-only step — fetch reviewed files and show the modal:

```js
elBtnDone.addEventListener('click', function () {
  elBtnDone.disabled = true;
  setStatus('loading review...', 'warn');

  api('/api/reviewed-files')
    .then(function (res) {
      if (res.files.length > 0) {
        showReviewTerminal(res.files);
        setStatus('review ready', 'ok');
        elBtnDone.disabled = false;  // server stays alive
      } else {
        setStatus('no annotations to review', 'warn');
        elBtnDone.disabled = false;
      }
    })
    .catch(function (err) {
      showTerminalError(err.message);
      elBtnDone.disabled = false;
    });
});
```

### 5. Review terminal modal

Update the existing terminal modal:

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

`showReviewTerminal(files)`:
- Set title: "Review Ready"
- Set message: summary (e.g., "N files with M total annotations")
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

### 7. Heartbeat: detect browser close, generate + shutdown

**New route: GET /api/ping**

```
GET /api/ping
→ { ok: true }
```

Server-side:
- Track `lastPingTime` on each request
- Start a timer on server startup that checks every 5s
- If `Date.now() - lastPingTime > 15000`:
  - Generate `.r.md` for all annotated files (safety net — Phase 1 already does this, but catch any edge cases)
  - Shut down server

```ts
// In startServer:
let lastPing = Date.now();

server.addListener("request", (req: ServerRequest) => {
  if (req.url === "/api/ping") {
    lastPing = Date.now();
    res({ ok: true });
    return;
  }
  // ... other routes
});

// Heartbeat check
const heartbeat = setInterval(() => {
  if (Date.now() - lastPing > 15000) {
    clearInterval(heartbeat);
    // Generate reviewed files for any that haven't been written
    for (const entry of fileStore.list()) {
      generateReviewedFile(entry, session);
    }
    // Shut down
    server.stop(true);
    session.release();
    resolveStopped();
  }
}, 5000);
```

**Frontend heartbeat:**

```js
// In app.js init:
setInterval(function () {
  api('/api/ping').catch(function () {
    // Server already gone — ignore
  });
}, 5000);
```

### 8. Backward compatibility

Keep `POST /api/done` for single-file: generates `.r.md` (already current), returns path, shuts down. Multi-file uses `GET /api/reviewed-files` + heartbeat.

## Acceptance criteria

- [ ] `GET /api/reviewed-files` returns files with `.r.md` paths and annotation counts
- [ ] Prompt lists reviewed file paths (agent reads them), not inline summaries
- [ ] Single-file prompt format unchanged (backward compat)
- [ ] Terminal modal shows multi-file summary with file list
- [ ] "Copy prompt" copies the correct prompt format
- [ ] Done does NOT trigger server shutdown
- [ ] Heartbeat ping every 5s from frontend
- [ ] Server shuts down after 15s of no pings
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/server/index.ts` — add `GET /api/reviewed-files`, `GET /api/ping`, heartbeat timer
- `src/frontend/app.js` — update Done handler, prompt format, terminal modal, heartbeat ping
- `src/frontend/page.html` — terminal modal CSS updates
