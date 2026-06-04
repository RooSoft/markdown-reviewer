# Phase 3 — Frontend: link interception, per-file view & annotation wiring

**Status:** `DONE`
**Depends on:** Phase 1 (Server per-file state), Phase 2 (Link detection)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 3. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `specs/002-multi-file-review` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/002/03-frontend-multi-file.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** Phase 1 added per-file routes `GET/POST /api/files/:key[/annotations[/:id]]` and `GET /api/files`. Phase 2 marks navigational links with a `data-md-link="<fileKey>"` attribute in the rendered HTML. The session-membership route `GET /api/session-files` is delivered in Phase 5; until it exists, fall back to `GET /api/files` for the initial list.
- **Scope boundary:** this phase wires the *behavior* (state, link interception, per-file switching, file-scoped CRUD, session-list fetch + refresh) and ships a **plain functional** Files list. The **crafted** Files navigation tree (visual design, tree ordering, row states, motion, keyboard) is **Phase 7** — do not polish the zone here.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun run typecheck` passes; link navigation and file-switching verified manually (or via the static integration test in Phase 8); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit.

---

## Note on UI scope

This phase is **behavioral wiring**, not visual craft. The Files list you build here is a plain, functional placeholder; the designed component is **Phase 7** (built with `/impeccable`). So you do **not** need to load `impeccable` or polish styling here — just keep the markup hooks (`#file-zone`, `#file-list`, `data-file-key`) so Phase 7 can attach to them. Match existing tokens for the few layout hooks you add, and stop there.

## Files touched

- `src/frontend/app.js` — link interception, per-file state, per-file view switching, file-scoped annotation CRUD, session-list fetch + refresh, functional `renderFileZone`.
- `src/frontend/page.html` — minimal `#file-zone` / `#file-list` markup hooks (no crafted styling — Phase 7).

## Pre-flight check (resume-after-compaction hint)

```sh
# Current frontend state model + annotation CRUD you will make file-scoped
rg -n "let blocks|let annotations|saveAnnotation|deleteAnnotation|/api/annotations|paintOverlays|renderSidebar|elDoc|elToolbarFile" src/frontend/app.js
# Sidebar markup + design tokens to match
rg -n "sidebar|--surface|--border|--violet-twilight|--dark-amethyst|--radius" src/frontend/page.html
bun run typecheck
```

If a step's outputs show the code already exists, that step is done — skip it and re-run its tests to confirm.

## UI specification

Add a **"Files" zone** to the sidebar (below the annotation list) that lists the session's files and lets the user switch between them. The zone is hidden when the session has exactly one file. The active file is highlighted. Each row shows the file name and its per-file annotation count. Clicking a `data-md-link` in the document, or a row in the zone, switches the view.

> ⚠ Match the existing sidebar/badge styling from `page.html` and `DESIGN.md`. The CSS below is a starting point — reconcile token names with what already exists.

### 1. State

```js
var files = [];           // [{ key, fileName, annotationCount, isEntry }]
var activeFileKey = null; // currently displayed file
var fileState = {};       // key -> { key, fileName, fullHtml, blocks, annotations, annotationCount }
```

### 2. Link click interception

```js
elDoc.addEventListener('click', function (e) {
  var link = e.target.closest('[data-md-link]');
  if (!link) return;
  e.preventDefault();
  loadFile(link.getAttribute('data-md-link'));
});
```

### 3. `loadFile(key)`

```js
async function loadFile(key) {
  if (fileState[key]) { switchToFile(key); return; }   // already loaded → just switch
  setStatus('loading ' + key + '...', 'warn');
  try {
    var mdRes = await api('/api/files/' + encodeURIComponent(key));
    var annRes = await api('/api/files/' + encodeURIComponent(key) + '/annotations');
    fileState[key] = {
      key: key,
      fileName: mdRes.fileName,
      fullHtml: mdRes.fullHtml,
      blocks: mdRes.blocks,
      annotations: annRes.annotations,
      annotationCount: annRes.annotations.length
    };
    upsertFileListItem(key, mdRes.fileName, annRes.annotations.length);
    switchToFile(key);
    await refreshSessionFiles();   // see note below
    setStatus('loaded ' + mdRes.fileName, 'ok');
  } catch (err) {
    setStatus('error: ' + err.message, 'error');
  }
}
```

> **Refresh the zone from the server after every load.** `upsertFileListItem` only adds the file you just clicked. But loading a file can pull *other* members into the session — both in the plain restore case (clicking a link to `A` whose session already contains `B`, `C`) and in the **session-merge** case (launching a fresh file, then linking into a pre-existing session; the server absorbs your run into that session — see Phase 5). So after a successful load, reconcile the local `files` list with the server's authoritative session membership:
>
> ```js
> async function refreshSessionFiles() {
>   var res;
>   try {
>     res = await api('/api/session-files');       // Phase 5 authoritative shape
>     files = res.files;                           // [{ key, fileName, annotationCount, isEntry }]
>   } catch (err) {
>     res = await api('/api/files');                // Phase 1 fallback: loaded files only
>     files = res.files.map(function (f) {
>       return Object.assign({}, f, { isEntry: f.key === res.activeKey });
>     });
>   }
>   renderFileZone();
> }
> ```
>
> The fallback exists only for Phase 1–4 development. It may omit manifest-only files and derives `isEntry` from `/api/files.activeKey`; once Phase 5 lands, `/api/session-files` is authoritative.
>
> Members the user has not opened this run appear in the zone immediately; their `fullHtml`/`blocks` are fetched lazily by `loadFile` on first click.

### 4. `switchToFile(key)`

```js
function switchToFile(key) {
  activeFileKey = key;
  var fileData = fileState[key];
  if (!fileData) return;
  elDoc.innerHTML = fileData.fullHtml;
  blocks = fileData.blocks;
  annotations = fileData.annotations;
  var fileEntry = files.find(function (f) { return f.key === key; });
  elToolbarFile.textContent = fileEntry ? fileEntry.fileName : fileData.fileName;
  paintOverlays();
  renderSidebar();
  renderFileZone();
  updateCount();
}
```

### 5. Files list (functional placeholder — the crafted tree is Phase 7)

Ship a **minimal, functional** list here so file-switching works end-to-end and this phase is verifiable. The polished component — tree ordering, muted-path-prefix rows, active/zero/scroll states, motion, and keyboard nav — is built in **Phase 7** with `/impeccable`. Keep the markup hooks below; styling stays minimal in this phase.

```html
<div id="file-zone" class="file-zone" style="display:none">
  <div class="file-zone-title">Files</div>
  <div id="file-list"></div>
</div>
```

> Phase 3 adds only layout hooks (no crafted styling). Phase 7 owns the visual spec, the `sortFilesForZone` tree ordering, and all row states. Do not invest in zone CSS here — it will be replaced.

### 6. `renderFileZone()` + click handler (functional)

A plain functional render is enough for Phase 3 (Phase 7 replaces it with the sorted, crafted version):

```js
function renderFileZone() {
  var elZone = document.getElementById('file-zone');
  var elList = document.getElementById('file-list');
  if (files.length <= 1) { elZone.style.display = 'none'; return; }
  elZone.style.display = '';
  var html = '';
  files.forEach(function (f) {   // Phase 7 sorts via sortFilesForZone(); Phase 3 may render as-is
    var activeClass = f.key === activeFileKey ? ' active' : '';
    html += '<div class="file-zone-item' + activeClass + '" data-file-key="' + escapeHtml(f.key) + '">';
    html += '<span class="file-zone-item-name">' + escapeHtml(f.key) + '</span>';
    html += '<span class="file-zone-item-count">' + f.annotationCount + '</span>';
    html += '</div>';
  });
  elList.innerHTML = html;
}

document.getElementById('file-list').addEventListener('click', function (e) {
  var item = e.target.closest('.file-zone-item');
  if (!item) return;
  loadFile(item.getAttribute('data-file-key')); // loadFile switches if already cached
});
```

> Use `loadFile` (not bare `switchToFile`) in the zone click handler so clicking a session file that hasn't been loaded this run lazily fetches it.

### 7. File-scoped annotation CRUD

Route all annotation reads/writes through the active file key:

```js
async function fileAnnotationsApi(key, opts) {
  return api('/api/files/' + encodeURIComponent(key) + '/annotations', opts);
}
async function fileAnnotationApi(key, id, opts) {
  return api('/api/files/' + encodeURIComponent(key) + '/annotations/' + encodeURIComponent(id), opts);
}
```

Update `saveAnnotation` / `deleteAnnotation` to use `activeFileKey`. After each save/delete:
- Refresh annotations for `activeFileKey`.
- `fileState[activeFileKey].annotations = refreshed.annotations`
- `fileState[activeFileKey].annotationCount = refreshed.annotations.length`
- Update the matching `files[]` item count.
- Re-render both the annotation sidebar and the file zone.

### 8. Init

On page load:
- Render the entry file from the injected `page.html` data (backward compatible), storing its complete state in `fileState[entryKey]` and setting `activeFileKey` to the entry key.
- Fetch the session file list (Phase 5's `GET /api/session-files`; if it does not yet exist, use `GET /api/files`) to populate `files`.
- For discovered files not yet in `fileState`, show them in the zone and lazily fetch their `fullHtml`/`blocks` on first click (via `loadFile`).
- Call `renderFileZone()` (hidden only when the session truly has one file).

## Work items

Tick each box as you complete it. Commit after each logical group.

- [x] Add `files` / `activeFileKey` / `fileState` to the state section.
- [x] Add `data-md-link` click interception on `#doc`.
- [x] Implement `loadFile`, `switchToFile`, `upsertFileListItem`.
- [x] Add minimal `#file-zone` / `#file-list` markup hooks to `page.html` (no crafted styling — Phase 7).
- [x] Implement a functional `renderFileZone` + zone click handler (routes through `loadFile`). Tree ordering/visual states are Phase 7.
- [x] Make annotation CRUD file-scoped via `activeFileKey`; update counts + re-render after save/delete.
- [x] Add `refreshSessionFiles()` and call it after every successful `loadFile` so absorbed/restored session members appear in the zone.
- [x] Wire init: seed entry-file state, fetch session list, populate zone.

## Acceptance criteria

- [x] Clicking a `data-md-link` loads the target file and switches the view.
- [x] The Files zone renders when >1 file is loaded and is hidden for a single-file session.
- [x] Clicking a file row switches the view (lazily loading it if not cached).
- [x] Annotations are scoped per-file (switching files shows the correct annotations).
- [x] Toolbar file name updates on switch.
- [x] Per-file annotation count updates after load, save, and delete.
- [x] Re-clicking a loaded file switches via `fileState` without a reload.
- [x] After loading a file that belongs to a pre-existing session (restore or merge), the zone shows the other session members (via `refreshSessionFiles`).
- [x] `bun run typecheck` passes.

> Visual/interaction acceptance (tree ordering, row states, active highlight, scroll, keyboard, motion, on-brand styling) is owned by **Phase 7**, not here.

## When done

1. Verify the acceptance criteria above are fully ticked.
2. `bun run typecheck && bun test`.
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase 3 to `DONE` (same commit).
5. Commit on the spec branch. Move to [`04-done-multi-file.md`](04-done-multi-file.md).
