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
  const elModalShortcut = $("#modal-shortcut");
  const elTerminal = $("#terminal");
  const elTerminalTitle = $("#terminal-title");
  const elTerminalMsg = $("#terminal-msg");
  const elTerminalPath = $("#terminal-path");
  const elTerminalCount = $("#terminal-count");
  const elTerminalFile = $("#terminal-file");
  const elTerminalError = $("#terminal-error");
  const elTerminalCopyPrompt = $("#terminal-copy-prompt");
  const elTerminalCopy = $("#terminal-copy");
  const elTerminalDismiss = $("#terminal-dismiss");

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  let blocks = [];
  let annotations = [];
  let activeBlockEl = null;   // the clicked block element
  let editingId = null;       // annotation id when editing
  let previousFocus = null;   // for focus restoration
  let modalConfirmDelete = false;  // modal in delete-confirmation mode
  let sidebarConfirmId = null;      // sidebar two-step delete: pending annotation id
  let revealPulseToken = 0;   // cancels pending locate pulses on rapid clicks

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

  function baseName(path) {
    return String(path || "").split(/[\\/]/).filter(Boolean).pop() || "_reviewed.md";
  }

  function sourcePathFromReviewPath(path) {
    return String(path || "").replace(/_reviewed\.md$/i, ".md");
  }

  function reviewSummaryText(count) {
    if (count === 0) {
      return "No comments this time. The reviewed markdown is ready for the next pass.";
    }
    if (count === 1) {
      return "One comment has been anchored and written into the reviewed file.";
    }
    return count + " comments have been anchored and written into the reviewed file.";
  }

  function showTerminal() {
    document.body.classList.add("terminal-open");
    elTerminal.classList.add("visible");
  }

  function hideTerminal() {
    elTerminal.classList.remove("visible");
    document.body.classList.remove("terminal-open");
  }

  function reviewPrompt(reviewPath) {
    var sourcePath = sourcePathFromReviewPath(reviewPath);

    return [
      "You are applying a completed markdown review.",
      "",
      "Read the reviewed file:",
      reviewPath,
      "",
      "Likely original source file:",
      sourcePath,
      "",
      "The reviewed file contains a summary section, then the original markdown with inline `<!-- Review: [N] ... -->` markers. Treat each numbered review comment as an instruction for the corresponding part of the source document.",
      "",
      "Your task:",
      "1. Locate the original source markdown file. It is usually next to the reviewed file and has the same name without `_reviewed`.",
      "2. Apply all clear review comments directly to the original source file.",
      "3. Preserve the author's formatting, structure, links, code fences, frontmatter, and wording unless a review comment asks for a change.",
      "4. Remove review markers from the final source. Do not copy the summary section into the source file.",
      "5. After editing, report what changed and list any review comments you could not apply.",
      "",
      "When uncertain:",
      "Do not guess. Ask the user a short numbered questionnaire with specific options or yes/no questions. Include only the questions needed to apply the review correctly. Wait for the user's answers before making uncertain edits.",
    ].join("\n");
  }

  function copyText(text, button, defaultLabel, copiedLabel) {
    if (!text) return;

    function copied() {
      button.textContent = copiedLabel;
      setStatus(copiedLabel.toLowerCase(), "ok");
      setTimeout(function () {
        button.textContent = defaultLabel;
      }, 1200);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copied).catch(function () {
        setStatus("copy failed", "error");
      });
    } else {
      var input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "readonly");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
        copied();
      } catch (err) {
        setStatus("copy failed", "error");
      }
      document.body.removeChild(input);
    }
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

  function findBlockForAnnotation(ann) {
    var blockEl = elDoc.querySelector('[data-anchor="' + anchorKey(ann.anchor) + '"]');
    if (blockEl) return blockEl;

    if (ann.status !== "stale") return null;

    var found = null;
    $$("#doc [data-block-id]").forEach(function (el) {
      if (found) return;
      var anchorStr = el.dataset.anchor;
      if (!anchorStr) return;

      var elParts = anchorStr.split(":");
      if (
        elParts[0] === ann.anchor.blockType &&
        parseInt(elParts[2], 10) === ann.anchor.siblingOrdinal
      ) {
        found = el;
      }
    });

    return found;
  }

  function pulseBlock(blockEl) {
    blockEl.classList.remove("annotation-pulse");
    // Force style recalc so repeated sidebar clicks replay the pulse.
    void blockEl.offsetWidth;
    blockEl.classList.add("annotation-pulse");

    window.setTimeout(function () {
      blockEl.classList.remove("annotation-pulse");
    }, 1300);
  }

  function pulseBlockAfterScroll(blockEl) {
    var token = ++revealPulseToken;
    var lastX = window.scrollX;
    var lastY = window.scrollY;
    var stableFrames = 0;
    var startedAt = performance.now();

    function tick() {
      if (token !== revealPulseToken) return;

      var currentX = window.scrollX;
      var currentY = window.scrollY;
      var hasMoved = Math.abs(currentX - lastX) > 0.5 || Math.abs(currentY - lastY) > 0.5;

      stableFrames = hasMoved ? 0 : stableFrames + 1;
      lastX = currentX;
      lastY = currentY;

      if (stableFrames >= 5 || performance.now() - startedAt > 1400) {
        pulseBlock(blockEl);
        return;
      }

      window.requestAnimationFrame(tick);
    }

    window.requestAnimationFrame(tick);
  }

  function revealAnnotation(annId) {
    var ann = annotations.find(function (a) { return a.id === annId; });
    if (!ann) return;

    var blockEl = findBlockForAnnotation(ann);
    if (!blockEl) {
      setStatus("annotation is orphaned", "warn");
      return;
    }

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    blockEl.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });
    if (reduceMotion) {
      pulseBlock(blockEl);
    } else {
      pulseBlockAfterScroll(blockEl);
    }
    setStatus("annotation located", ann.status === "stale" ? "warn" : "ok");
  }

  // -----------------------------------------------------------------------
  // Sidebar
  // -----------------------------------------------------------------------
  function renderSidebar() {
    sidebarConfirmId = null;  // reset on re-render
    var okAnns = annotations.filter(function (a) { return a.status !== "orphaned"; });
    var orphanAnns = annotations.filter(function (a) { return a.status === "orphaned"; });

    // Update header count
    var elCount = document.getElementById("sidebar-header-count");
    if (elCount) {
      elCount.textContent = annotations.length > 0 ? annotations.length + " total" : "";
    }

    if (annotations.length === 0) {
      elSidebarList.innerHTML =
        '<div class="sidebar-empty">' +
        '  <div class="sidebar-empty-icon">⊕</div>' +
        '  <div class="sidebar-empty-text">No annotations yet.<br>Click a block to add one.</div>' +
        "</div>";
      return;
    }

    var html = "";

    if (okAnns.length > 0) {
      html += '<div class="sidebar-section">';
      okAnns.forEach(function (a, i) {
        html += sidebarItem(a, i + 1, orphanAnns.length === 0);
      });
      html += "</div>";
    }

    if (orphanAnns.length > 0) {
      html += '<div class="sidebar-section">';
      html += '<div class="sidebar-section-title">Orphaned</div>';
      orphanAnns.forEach(function (a, i) {
        html += sidebarItem(a, i + 1, true);
      });
      html += "</div>";
    }

    elSidebarList.innerHTML = html;
  }

  function sidebarItem(a, index, showStatusOk) {
    var escapedComment = escapeHtml(a.comment);
    var statusHtml = "";

    if (a.status === "stale") {
      statusHtml = '<span class="sidebar-item-status stale">stale</span>';
    } else if (a.status === "orphaned") {
      statusHtml = '<span class="sidebar-item-status orphaned">orphaned</span>';
    }

    // Line range metadata
    var linesHtml = "";
    if (a.blockLineRange && a.blockLineRange.length === 2 && a.blockLineRange[0] > 0) {
      var lineLabel = a.blockLineRange[0] === a.blockLineRange[1]
        ? "line " + a.blockLineRange[0]
        : "lines " + a.blockLineRange[0] + "–" + a.blockLineRange[1];
      linesHtml = '<span class="sidebar-item-lines">' + escapeHtml(lineLabel) + "</span>";
    }

    var metaHtml = "";
    if (linesHtml || statusHtml) {
      metaHtml = '<div class="sidebar-item-meta">' + linesHtml + statusHtml + "</div>";
    }

    var html = '<div class="sidebar-item" tabindex="0" data-ann-id="' + escapeHtml(a.id) + '">';
    html += '<span class="sidebar-item-number">' + index + "</span>";
    html += '<div class="sidebar-item-body">';
    html += '<div class="sidebar-item-comment">' + escapedComment + "</div>";
    html += metaHtml;
    html += '<div class="sidebar-item-actions">';
    html += '<button class="sidebar-item-btn" data-action="edit">Edit</button>';
    html += '<button class="sidebar-item-btn sidebar-item-btn--danger" data-action="delete">Delete</button>';
    html += "</div></div></div>";
    return html;
  }

  // Sidebar event delegation
  elSidebarList.addEventListener("click", function (e) {
    var item = e.target.closest(".sidebar-item");
    if (!item) return;

    var itemAnnId = item.dataset.annId;

    // Clicking any item clears pending confirm on a different item
    if (sidebarConfirmId && sidebarConfirmId !== itemAnnId) {
      var oldBtn = elSidebarList.querySelector('[data-action="delete"][data-confirm-pending="true"]');
      if (oldBtn) {
        oldBtn.textContent = "Delete";
        oldBtn.classList.remove("confirming");
        oldBtn.removeAttribute("data-confirm-pending");
      }
      sidebarConfirmId = null;
    }

    var btn = e.target.closest("[data-action]");
    if (btn) {
      e.stopPropagation();
      var action = btn.dataset.action;

      if (action === "edit") {
        sidebarConfirmId = null;
        var confirmingBtns = elSidebarList.querySelectorAll('[data-confirm-pending="true"]');
        confirmingBtns.forEach(function (b) {
          b.textContent = "Delete";
          b.classList.remove("confirming");
          b.removeAttribute("data-confirm-pending");
        });
        var ann = annotations.find(function (a) { return a.id === itemAnnId; });
        if (ann) openModalForAnnotation(ann);
      } else if (action === "delete") {
        if (sidebarConfirmId === itemAnnId) {
          sidebarConfirmId = null;
          deleteAnnotation(itemAnnId);
        } else {
          sidebarConfirmId = itemAnnId;
          btn.textContent = "Sure?";
          btn.classList.add("confirming");
          btn.setAttribute("data-confirm-pending", "true");
        }
      }
    }

    revealAnnotation(itemAnnId);
  });

  elSidebarList.addEventListener("keydown", function (e) {
    if (e.target.closest("button")) return;
    if (e.key !== "Enter" && e.key !== " ") return;

    var item = e.target.closest(".sidebar-item");
    if (!item) return;

    e.preventDefault();
    revealAnnotation(item.dataset.annId);
  });

  // Sidebar toggle + scroll sync
  var elDocWrap = $("#doc-wrap");

  function syncSidebarScroll() {
    if (!elSidebar.classList.contains("open")) return;
    var docEl = elDoc;
    var docScrollTop = docEl.scrollTop || window.scrollY;
    var docScrollHeight = docEl.scrollHeight || document.documentElement.scrollHeight;
    var docClientHeight = docEl.clientHeight || window.innerHeight;
    var ratio = docScrollHeight > docClientHeight
      ? docScrollTop / (docScrollHeight - docClientHeight)
      : 0;
    var inner = document.getElementById("sidebar-inner");
    if (!inner) return;
    var innerScrollHeight = inner.scrollHeight;
    var innerClientHeight = inner.clientHeight;
    if (innerScrollHeight <= innerClientHeight) return;
    inner.scrollTop = ratio * (innerScrollHeight - innerClientHeight);
  }

  elBtnSidebar.addEventListener("click", function () {
    elSidebar.classList.toggle("open");
    elDocWrap.classList.toggle("sidebar-open", elSidebar.classList.contains("open"));
    if (elSidebar.classList.contains("open")) {
      syncSidebarScroll();
    }
  });

  // Close sidebar on Escape (when modal is not open)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && elSidebar.classList.contains("open") && !elModalOverlay.classList.contains("open")) {
      elSidebar.classList.remove("open");
      elDocWrap.classList.remove("sidebar-open");
    }
  });

  // Keep sidebar scroll synced with document scroll
  window.addEventListener("scroll", syncSidebarScroll, { passive: true });

  // Open sidebar from count pill or status bar
  function openSidebar() {
    if (!elSidebar.classList.contains("open")) {
      elSidebar.classList.add("open");
      elDocWrap.classList.add("sidebar-open");
      syncSidebarScroll();
    }
  }

  elToolbarCount.addEventListener("click", openSidebar);
  elStatusBar.addEventListener("click", openSidebar);

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

    var blockEl = findBlockForAnnotation(ann);
    if (blockEl) {
      activeBlockEl = blockEl;
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
    modalConfirmDelete = false;
    activeBlockEl = null;
    editingId = null;
    if (previousFocus) previousFocus.focus();
  }

  // Switch modal into delete-confirmation mode
  function enterModalConfirmDelete() {
    modalConfirmDelete = true;
    elModalTitle.textContent = "Delete Comment";
    elModalContext.textContent = "This will permanently remove this comment. This cannot be undone.";
    elModalContext.classList.add("modal-context--warning");
    elModalTextarea.style.display = "none";
    elModalDelete.style.display = "none";
    elModalShortcut.style.display = "none";
    elModalCancel.textContent = "Cancel";
    elModalSave.textContent = "Delete comment";
    elModalSave.classList.add("modal-btn--danger");
    elModalSave.focus();
  }

  // Restore modal from delete-confirmation mode
  function exitModalConfirmDelete() {
    modalConfirmDelete = false;
    elModalTitle.textContent = "Edit Comment";
    var ann = annotations.find(function (a) { return a.id === editingId; });
    elModalContext.textContent = ann ? (ann.blockText || ann.comment) : "";
    elModalContext.classList.remove("modal-context--warning");
    elModalTextarea.style.display = "";
    elModalTextarea.value = ann ? ann.comment : "";
    elModalDelete.style.display = "";
    elModalShortcut.style.display = "";
    elModalCancel.textContent = "Cancel";
    elModalSave.textContent = "Save";
    elModalSave.classList.remove("modal-btn--danger");
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

  elModalCancel.addEventListener("click", function () {
    if (modalConfirmDelete) {
      exitModalConfirmDelete();
    } else {
      closeModal();
    }
  });

  elModalSave.addEventListener("click", function () {
    if (modalConfirmDelete) {
      // Confirm delete
      if (editingId) {
        deleteAnnotation(editingId);
        closeModal();
      }
    } else {
      var comment = elModalTextarea.value.trim();
      if (!comment) return;
      saveAnnotation(comment);
    }
  });

  elModalDelete.addEventListener("click", function () {
    if (editingId && !modalConfirmDelete) {
      enterModalConfirmDelete();
    }
  });

  // Keyboard
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && elModalOverlay.classList.contains("open")) {
      if (modalConfirmDelete) {
        exitModalConfirmDelete();
      } else {
        closeModal();
      }
    }
    trapFocus(e);

    // Enter to save/confirm (when in textarea or confirm mode, Enter with Ctrl/Cmd)
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
      setStatus(editingId ? "annotation updated" : "annotation added", "ok");
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
          var count = annotations.length;
          elTerminalPath.textContent = res.path;
          elTerminalCount.textContent = String(count);
          elTerminalFile.textContent = baseName(res.path);
          elTerminalTitle.textContent = "Review Complete";
          elTerminalMsg.textContent = reviewSummaryText(count);
          elTerminal.classList.remove("terminal--error");
          elTerminalError.classList.remove("visible");
          showTerminal();
          setTimeout(function () { elTerminalCopyPrompt.focus(); }, 50);
          setStatus("review written", "ok");
          // Don't re-enable Done — server is shutting down
        } else {
          throw new Error(res.error || "Unknown error");
        }
      })
      .catch(function (err) {
        elTerminalTitle.textContent = "Review Failed";
        elTerminalMsg.textContent = "The server could not write the reviewed markdown. Your annotations are still in this session.";
        elTerminal.classList.add("terminal--error");
        elTerminalPath.textContent = "";
        elTerminalError.textContent = "Error: " + err.message;
        elTerminalError.classList.add("visible");
        showTerminal();
        setTimeout(function () { elTerminalDismiss.focus(); }, 50);
        setStatus("error generating review", "error");
        // Re-enable on error so user can retry
        elBtnDone.disabled = false;
      });
  });

  elTerminalCopy.addEventListener("click", function () {
    var path = elTerminalPath.textContent;
    copyText(path, elTerminalCopy, "Copy path", "Path copied");
  });

  elTerminalCopyPrompt.addEventListener("click", function () {
    var path = elTerminalPath.textContent;
    copyText(reviewPrompt(path), elTerminalCopyPrompt, "Copy prompt", "Prompt copied");
  });

  elTerminalDismiss.addEventListener("click", function () {
    hideTerminal();
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

      // Set file name (injected server-side, fallback to URL path)
      var fileName = document.body.dataset.fileName || window.location.pathname.replace(/^\//, "") || "document.md";
      elToolbarFile.textContent = fileName;

      // Paint overlays
      paintOverlays();
      renderSidebar();

      // Set keyboard shortcut label based on platform
      var isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
        || (navigator.userAgentData && navigator.userAgentData.platform.toUpperCase().indexOf("MAC") >= 0);
      elModalShortcut.innerHTML = isMac
        ? '<kbd>⌘</kbd> <kbd>Enter</kbd>'
        : '<kbd>Ctrl</kbd> <kbd>Enter</kbd>';

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
