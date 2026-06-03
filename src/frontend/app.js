/**
 * markdown-reviewer — frontend interaction layer
 *
 * Talks to the server API:
 *   GET    /api/markdown        → { source, blocks }
 *   GET    /api/annotations     → { annotations }
 *   POST   /api/annotations     → { annotation }
 *   DELETE /api/annotations/:id → { ok }
 *   POST   /api/done            → { ok, path } | { ok: false, error }
 */

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // DOM refs
  // -----------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const elLoading = $("#loading");
  const elToolbarFile = $("#toolbar-file");
  const elToolbarCount = $("#toolbar-count");
  const elBtnSidebar = $("#btn-sidebar");
  const elBtnDone = $("#btn-done");
  const elDoc = $("#doc");
  const elEmptyHint = $("#empty-hint");
  const elSidebar = $("#sidebar");
  const elSidebarList = $("#sidebar-list");
  const elStatusBar = $("#status-bar");
  const elStatusText = $("#status-text");
  const elModal = $("#modal");
  const elModalOverlay = $("#modal-overlay");
  const elModalBackdrop = $("#modal-backdrop");
  const elModalTitle = $("#modal-title");
  const elModalClose = $("#modal-close");
  const elModalContext = $("#modal-context");
  const elModalTextarea = $("#modal-textarea");
  const elModalDelete = $("#modal-delete");
  const elModalCancel = $("#modal-cancel");
  const elModalSave = $("#modal-save");
  const elTerminal = $("#terminal");
  const elTerminalPath = $("#terminal-path");
  const elTerminalError = $("#terminal-error");
  const elTerminalDismiss = $("#terminal-dismiss");

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  let blocks = [];
  let annotations = [];
  let activeBlockEl = null;   // the clicked block element
  let editingId = null;       // annotation id when editing
  let previousFocus = null;   // for focus restoration

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  function escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
  }

  function anchorKey(anchor) {
    return anchor.blockType + ":" + anchor.textHash + ":" + anchor.siblingOrdinal;
  }

  function setStatus(msg, type) {
    const dot = type ? '<span class="status-dot ' + type + '"></span>' : "";
    elStatusText.innerHTML = dot + msg;
  }

  function updateCount() {
    const count = annotations.length;
    elToolbarCount.textContent = count + (count === 1 ? " annotation" : " annotations");
    elEmptyHint.classList.toggle("visible", count === 0 && blocks.length > 0);
  }

  // -----------------------------------------------------------------------
  // API
  // -----------------------------------------------------------------------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // -----------------------------------------------------------------------
  // Block overlays
  // -----------------------------------------------------------------------
  function paintOverlays() {
    // Clear all
    $$("#doc [data-block-id]").forEach(function (el) {
      el.classList.remove("annotated", "stale");
    });

    // Build anchor → annotation map (exact match for ok annotations)
    const annByAnchor = {};
    annotations.forEach(function (a) {
      if (a.status === "ok") {
        annByAnchor[anchorKey(a.anchor)] = a;
      }
    });

    // Build blockType:ordinal → annotation map for stale annotations
    // (textHash changed, so full anchor won't match; match on position instead)
    const annByPos = {};
    annotations.forEach(function (a) {
      if (a.status === "stale") {
        var posKey = a.anchor.blockType + ":" + a.anchor.siblingOrdinal;
        annByPos[posKey] = a;
      }
    });

    // Paint
    $$("#doc [data-block-id]").forEach(function (el) {
      var key = el.dataset.anchor;
      if (!key) return;

      var a = annByAnchor[key];
      if (!a) {
        // For stale annotations, match on blockType:siblingOrdinal
        var parts = key.split(":");
        var posKey = parts[0] + ":" + parts[2];
        a = annByPos[posKey];
      }

      if (a) {
        el.classList.add("annotated");
        if (a.status === "stale") {
          el.classList.add("stale");
        }
      }
    });

    updateCount();
  }

  // -----------------------------------------------------------------------
  // Sidebar
  // -----------------------------------------------------------------------
  function renderSidebar() {
    if (annotations.length === 0) {
      elSidebarList.innerHTML = '<div class="sidebar-empty">No annotations yet.<br>Click a block to add one.</div>';
      return;
    }

    const okAnns = annotations.filter(function (a) { return a.status !== "orphaned"; });
    const orphanAnns = annotations.filter(function (a) { return a.status === "orphaned"; });

    var html = "";

    if (okAnns.length > 0) {
      html += '<div class="sidebar-section">';
      html += '<div class="sidebar-section-title">Active</div>';
      okAnns.forEach(function (a) {
        html += sidebarItem(a);
      });
      html += "</div>";
    }

    if (orphanAnns.length > 0) {
      html += '<div class="sidebar-section">';
      html += '<div class="sidebar-section-title">Orphaned</div>';
      orphanAnns.forEach(function (a) {
        html += sidebarItem(a);
      });
      html += "</div>";
    }

    elSidebarList.innerHTML = html;
  }

  function sidebarItem(a) {
    var escapedComment = escapeHtml(a.comment);
    var typeLabel = a.blockType.replace(/([A-Z])/g, " $1").trim();
    var statusClass = a.status;
    var statusLabel = a.status === "orphaned" ? "orphaned" : a.status === "stale" ? "stale" : "ok";

    var html = '<div class="sidebar-item" tabindex="0" data-ann-id="' + escapeHtml(a.id) + '">';
    html += '<div class="sidebar-item-header">';
    html += '<span class="sidebar-item-type">' + escapeHtml(typeLabel) + "</span>";
    html += '<span class="sidebar-item-status ' + statusClass + '">' + statusLabel + "</span>";
    html += "</div>";
    html += '<div class="sidebar-item-comment">' + escapedComment + "</div>";
    html += '<div class="sidebar-item-actions">';
    html += '<button class="sidebar-item-btn" data-action="edit">Edit</button>';
    html += '<button class="sidebar-item-btn sidebar-item-btn--danger" data-action="delete">Delete</button>';
    html += "</div>";
    html += "</div>";
    return html;
  }

  // Sidebar event delegation
  elSidebarList.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();

    var item = btn.closest(".sidebar-item");
    var annId = item.dataset.annId;
    var action = btn.dataset.action;

    if (action === "edit") {
      var ann = annotations.find(function (a) { return a.id === annId; });
      if (ann) openModalForAnnotation(ann);
    } else if (action === "delete") {
      deleteAnnotation(annId);
    }
  });

  // Sidebar toggle
  elBtnSidebar.addEventListener("click", function () {
    elSidebar.classList.toggle("open");
  });

  // -----------------------------------------------------------------------
  // Modal
  // -----------------------------------------------------------------------
  function openModal(blockEl) {
    activeBlockEl = blockEl;
    editingId = null;

    // Check if this block already has an annotation
    var blockAnchorKey = blockEl.dataset.anchor;
    var existing = annotations.find(function (a) {
      return anchorKey(a.anchor) === blockAnchorKey;
    });

    if (existing) {
      editingId = existing.id;
      elModalTitle.textContent = "Edit Comment";
      elModalContext.textContent = existing.blockText || blockEl.textContent.trim().slice(0, 200);
      elModalTextarea.value = existing.comment;
      elModalDelete.style.display = "";
    } else {
      elModalTitle.textContent = "Add Comment";
      elModalContext.textContent = blockEl.textContent.trim().slice(0, 200);
      elModalTextarea.value = "";
      elModalDelete.style.display = "none";
    }

    elModalOverlay.classList.add("open");
    previousFocus = document.activeElement;
    // Focus textarea after transition
    setTimeout(function () { elModalTextarea.focus(); }, 50);
  }

  function openModalForAnnotation(ann) {
    editingId = ann.id;
    activeBlockEl = null;

    // Try to find the block element by full anchor
    var blockEl = elDoc.querySelector('[data-anchor="' + anchorKey(ann.anchor) + '"]');
    if (blockEl) {
      activeBlockEl = blockEl;
    } else if (ann.status === "stale") {
      // For stale annotations, the textHash changed — match on blockType:siblingOrdinal
      var parts = ann.anchor;
      $$("#doc [data-block-id]").forEach(function (el) {
        if (activeBlockEl) return; // already found
        var anchorStr = el.dataset.anchor;
        if (!anchorStr) return;
        var elParts = anchorStr.split(":");
        if (elParts[0] === parts.blockType && parseInt(elParts[2], 10) === parts.siblingOrdinal) {
          activeBlockEl = el;
        }
      });
    }

    elModalTitle.textContent = "Edit Comment";
    elModalContext.textContent = ann.blockText || ann.comment;
    elModalTextarea.value = ann.comment;
    elModalDelete.style.display = "";

    elModalOverlay.classList.add("open");
    previousFocus = document.activeElement;
    setTimeout(function () { elModalTextarea.focus(); }, 50);
  }

  function closeModal() {
    elModalOverlay.classList.remove("open");
    activeBlockEl = null;
    editingId = null;
    if (previousFocus) previousFocus.focus();
  }

  // Focus trap for modal
  function trapFocus(e) {
    if (!elModalOverlay.classList.contains("open")) return;

    var focusable = elModal.querySelectorAll(
      'button, textarea, input, [tabindex]:not([tabindex="-1"])'
    );
    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (e.key === "Tab") {
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  // Modal event listeners
  elModalClose.addEventListener("click", closeModal);
  elModalBackdrop.addEventListener("click", closeModal);
  elModalCancel.addEventListener("click", closeModal);

  elModalSave.addEventListener("click", function () {
    var comment = elModalTextarea.value.trim();
    if (!comment) return;

    saveAnnotation(comment);
  });

  elModalDelete.addEventListener("click", function () {
    if (editingId) {
      deleteAnnotation(editingId);
      closeModal();
    }
  });

  // Keyboard
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && elModalOverlay.classList.contains("open")) {
      closeModal();
    }
    trapFocus(e);

    // Enter to save (when in textarea, Enter with Ctrl/Cmd)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && elModalOverlay.classList.contains("open")) {
      e.preventDefault();
      elModalSave.click();
    }
  });

  // -----------------------------------------------------------------------
  // Block click
  // -----------------------------------------------------------------------
  elDoc.addEventListener("click", function (e) {
    var block = e.target.closest("[data-block-id]");
    if (!block) return;
    openModal(block);
  });

  // -----------------------------------------------------------------------
  // Annotation CRUD
  // -----------------------------------------------------------------------
  async function saveAnnotation(comment) {
    var anchor, blockText, blockLineRange;

    if (activeBlockEl) {
      var anchorStr = activeBlockEl.dataset.anchor;
      var parts = anchorStr.split(":");
      anchor = {
        blockType: parts[0],
        textHash: parts[1],
        siblingOrdinal: parseInt(parts[2], 10),
      };
      blockText = activeBlockEl.textContent.trim().slice(0, 500);
      blockLineRange = parseLineRange(activeBlockEl);
    } else if (editingId) {
      // Stale/orphan annotation being edited without a matched block
      var existingAnn = annotations.find(function (a) { return a.id === editingId; });
      if (existingAnn) {
        anchor = existingAnn.anchor;
        blockText = existingAnn.blockText;
        blockLineRange = existingAnn.blockLineRange;
      } else {
        return; // shouldn't happen, but safety
      }
    } else {
      return;
    }

    var body = {
      anchor: anchor,
      blockType: anchor.blockType,
      blockText: blockText,
      blockLineRange: blockLineRange,
      comment: comment,
    };

    if (editingId) {
      body.id = editingId;
    }

    try {
      var res = await api("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Refresh annotations
      var annRes = await api("/api/annotations");
      annotations = annRes.annotations;
      paintOverlays();
      renderSidebar();
      setStatus(editingId ? "comment updated" : "comment added", "ok");
      closeModal();
    } catch (err) {
      setStatus("error: " + err.message, "error");
    }
  }

  async function deleteAnnotation(id) {
    try {
      await api("/api/annotations/" + encodeURIComponent(id), { method: "DELETE" });

      annotations = annotations.filter(function (a) { return a.id !== id; });
      paintOverlays();
      renderSidebar();
      setStatus("annotation removed", "ok");
    } catch (err) {
      setStatus("error: " + err.message, "error");
    }
  }

  function parseLineRange(el) {
    // Read line range from data-line-range attribute (set by server)
    var rangeStr = el.dataset.lineRange;
    if (rangeStr) {
      try {
        var parsed = JSON.parse(rangeStr);
        if (Array.isArray(parsed) && parsed.length === 2) return parsed;
      } catch (e) { /* ignore */ }
    }
    return [0, 0];
  }

  // -----------------------------------------------------------------------
  // Done
  // -----------------------------------------------------------------------
  elBtnDone.addEventListener("click", function () {
    elBtnDone.disabled = true;
    setStatus("generating review…", "warn");

    api("/api/done", { method: "POST" })
      .then(function (res) {
        if (res.ok) {
          elTerminalPath.textContent = res.path;
          elTerminalError.classList.remove("visible");
          elTerminal.classList.add("visible");
          setStatus("review written", "ok");
          // Don't re-enable Done — server is shutting down
        } else {
          throw new Error(res.error || "Unknown error");
        }
      })
      .catch(function (err) {
        elTerminalError.textContent = "Error: " + err.message;
        elTerminalError.classList.add("visible");
        elTerminal.classList.add("visible");
        setStatus("error generating review", "error");
        // Re-enable on error so user can retry
        elBtnDone.disabled = false;
      });
  });

  elTerminalDismiss.addEventListener("click", function () {
    elTerminal.classList.remove("visible");
  });

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  async function init() {
    try {
      // Load markdown and annotations in parallel
      var mdRes = await api("/api/markdown");
      var annRes = await api("/api/annotations");

      blocks = mdRes.blocks;
      annotations = annRes.annotations;

      // Set file name from URL path
      var fileName = window.location.pathname.replace(/^\//, "") || "document.md";
      elToolbarFile.textContent = fileName;

      // Paint overlays
      paintOverlays();
      renderSidebar();

      // Hide loading
      elLoading.classList.add("hidden");

      // Show empty hint if no annotations
      updateCount();

      setStatus("ready");
    } catch (err) {
      elLoading.textContent = "Failed to load: " + err.message;
      setStatus("error: " + err.message, "error");
    }
  }

  init();
})();
