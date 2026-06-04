# Phase 3 — Frontend: sidebar file zone, link interception, per-file view

**Status:** `TODO`
**Depends on:** Phase 1 (Server per-file state), Phase 2 (Link detection)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

The frontend currently loads one document and shows its annotations. For multi-file, we need:
1. A "Files" zone in the sidebar listing navigated files
2. Click interception on `data-md-link` to load new files
3. Per-file view switching (document + annotations)

## Implementation

### 1. State

Add to `app.js` state section:

```js
var files = [];           // array of { key, fileName, annotationCount, isEntry }
var activeFileKey = null; // currently displayed file
var fileState = {};       // key -> { key, fileName, fullHtml, blocks, annotations, annotationCount }
```

### 2. Link click interception

Add click handler on `#doc` for `data-md-link`:

```js
elDoc.addEventListener('click', function (e) {
  var link = e.target.closest('[data-md-link]');
  if (!link) return;
  
  var targetKey = link.getAttribute('data-md-link');
  e.preventDefault();
  loadFile(targetKey);
});
```

### 3. loadFile function

```js
async function loadFile(key) {
  // If already loaded, just switch view
  if (fileState[key]) {
    switchToFile(key);
    return;
  }
  
  // Load from server
  setStatus('loading ' + key + '...', 'warn');
  
  try {
    var mdRes = await api('/api/files/' + encodeURIComponent(key));
    var annRes = await api('/api/files/' + encodeURIComponent(key) + '/annotations');
    
    // Store complete file data required for future switches
    fileState[key] = {
      key: key,
      fileName: mdRes.fileName,
      fullHtml: mdRes.fullHtml,
      blocks: mdRes.blocks,
      annotations: annRes.annotations,
      annotationCount: annRes.annotations.length
    };
    
    // Add/update files list
    upsertFileListItem(key, mdRes.fileName, annRes.annotations.length);
    
    switchToFile(key);
    renderFileZone();
    setStatus('loaded ' + mdRes.fileName, 'ok');
  } catch (err) {
    setStatus('error: ' + err.message, 'error');
  }
}
```

### 4. switchToFile function

```js
function switchToFile(key) {
  activeFileKey = key;
  
  // Update document content and active in-memory state
  var fileData = fileState[key];
  if (!fileData) return;
  elDoc.innerHTML = fileData.fullHtml;
  blocks = fileData.blocks;
  annotations = fileData.annotations;
  
  // Update toolbar
  var fileEntry = files.find(function (f) { return f.key === key; });
  elToolbarFile.textContent = fileEntry.fileName;
  
  // Display annotations for this file
  paintOverlays();
  renderSidebar();
  renderFileZone();
  updateCount();
}
```

### 5. Sidebar file zone

Add to sidebar HTML (below annotation list):

```html
<div id="file-zone" class="file-zone" style="display:none">
  <div class="file-zone-title">Files</div>
  <div id="file-list"></div>
</div>
```

CSS (add to `page.html`):

```css
.file-zone {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.file-zone-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.file-zone-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 4px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 13px;
  transition: border-color var(--transition-fast);
}

.file-zone-item:hover {
  border-color: var(--dark-amethyst);
}

.file-zone-item.active {
  border-color: var(--violet-twilight);
  background: oklch(0.14 0.04 295);
}

.file-zone-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.file-zone-item-count {
  flex-shrink: 0;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  background: var(--dark-amethyst);
  padding: 1px 6px;
  border-radius: 99px;
}
```

### 6. renderFileZone function

```js
function renderFileZone() {
  var elZone = document.getElementById('file-zone');
  var elList = document.getElementById('file-list');
  
  // Only show if more than one file
  if (files.length <= 1) {
    elZone.style.display = 'none';
    return;
  }
  
  elZone.style.display = '';
  var html = '';
  
  files.forEach(function (f) {
    var activeClass = f.key === activeFileKey ? ' active' : '';
    html += '<div class="file-zone-item' + activeClass + '" data-file-key="' + escapeHtml(f.key) + '">';
    html += '<span class="file-zone-item-name">' + escapeHtml(f.fileName) + '</span>';
    html += '<span class="file-zone-item-count">' + f.annotationCount + '</span>';
    html += '</div>';
  });
  
  elList.innerHTML = html;
}
```

### 7. File zone click handler

```js
document.getElementById('file-list').addEventListener('click', function (e) {
  var item = e.target.closest('.file-zone-item');
  if (!item) return;
  
  var key = item.getAttribute('data-file-key');
  switchToFile(key);
});
```

### 8. Update annotation CRUD

Change annotation routes to use the active file key:

```js
// Instead of /api/annotations, use /api/files/{activeFileKey}/annotations
async function fileAnnotationsApi(key, opts) {
  return api('/api/files/' + encodeURIComponent(key) + '/annotations', opts);
}

async function fileAnnotationApi(key, id, opts) {
  return api('/api/files/' + encodeURIComponent(key) + '/annotations/' + encodeURIComponent(id), opts);
}
```

Update `saveAnnotation`, `deleteAnnotation` to use `activeFileKey`.

After save/delete:
- Refresh annotations for `activeFileKey`
- Assign `fileState[activeFileKey].annotations = refreshed.annotations`
- Assign `fileState[activeFileKey].annotationCount = refreshed.annotations.length`
- Update the matching `files[]` item count
- Re-render both the annotation sidebar and file zone

### 9. Update init

On page load:
- Fetch entry file data from existing routes (backward compatible) or `/api/files/{entryKey}` if exposed
- Fetch `/api/session-files` to populate `files`
- Store complete state for the entry file in `fileState[entryKey]`
- Set `activeFileKey` to the entry file key
- For discovered files that are not loaded yet, show them in the file zone but lazily fetch their `fullHtml`/`blocks` when clicked
- Call `renderFileZone()` (hidden only when the session truly has one file)

## Acceptance criteria

- [ ] Clicking a `data-md-link` loads the target file and switches view
- [ ] Sidebar "Files" zone appears when >1 file is loaded
- [ ] Clicking a file in the zone switches the view
- [ ] Active file is highlighted in the zone
- [ ] Annotations are scoped per-file (switching files shows correct annotations)
- [ ] Toolbar file name updates on switch
- [ ] Annotation count updates per-file after load, save, and delete
- [ ] Re-clicking a loaded file just switches using `fileState` (no reload)
- [ ] `bun run typecheck` passes (if TS frontend) / manual verification

## Files to modify

- `src/frontend/app.js` — link interception, file zone, per-file state
- `src/frontend/page.html` — file zone HTML + CSS
