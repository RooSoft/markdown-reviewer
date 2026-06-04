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
var files = [];           // array of { key, fileName, annotationCount }
var activeFileKey = null; // currently displayed file
var fileAnnotations = {}; // key -> [annotations]
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
  if (fileAnnotations[key]) {
    switchToFile(key);
    return;
  }
  
  // Load from server
  setStatus('loading ' + key + '...', 'warn');
  
  try {
    var mdRes = await api('/api/files/' + encodeURIComponent(key));
    var annRes = await api('/api/files/' + encodeURIComponent(key) + '/annotations');
    
    // Store file data
    fileAnnotations[key] = annRes.annotations;
    
    // Add to files list if not present
    if (!files.find(function (f) { return f.key === key; })) {
      files.push({
        key: key,
        fileName: mdRes.fileName,
        annotationCount: annRes.annotations.length
      });
    }
    
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
  
  // Update document content
  var fileData = fileAnnotations[key];  // blocks stored elsewhere
  elDoc.innerHTML = /* fullHtml for this file */;
  
  // Update toolbar
  var fileEntry = files.find(function (f) { return f.key === key; });
  elToolbarFile.textContent = fileEntry.fileName;
  
  // Load and display annotations for this file
  annotations = fileAnnotations[key] || [];
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

### 9. Update init

On page load:
- Fetch entry file data from existing routes (backward compatible)
- Populate `files` array with entry file
- Set `activeFileKey` to entry file key
- Call `renderFileZone()` (will hide since only 1 file)

## Acceptance criteria

- [ ] Clicking a `data-md-link` loads the target file and switches view
- [ ] Sidebar "Files" zone appears when >1 file is loaded
- [ ] Clicking a file in the zone switches the view
- [ ] Active file is highlighted in the zone
- [ ] Annotations are scoped per-file (switching files shows correct annotations)
- [ ] Toolbar file name updates on switch
- [ ] Annotation count updates per-file
- [ ] Re-clicking a loaded file just switches (no reload)
- [ ] `bun run typecheck` passes (if TS frontend) / manual verification

## Files to modify

- `src/frontend/app.js` — link interception, file zone, per-file state
- `src/frontend/page.html` — file zone HTML + CSS
