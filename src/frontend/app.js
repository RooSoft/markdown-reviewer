/*
 * Minimal fetch harness for markdown-reviewer.
 * Placeholder only — rebuilt in Phase 7.
 */

"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const statusEl = $("#status");
  const annotationsEl = $("#annotations");
  const doneBtn = $("#btn-done");

  setStatus("Loading…");

  // Load markdown + annotations on startup
  Promise.all([
    fetch("/api/markdown").then((r) => r.json()),
    fetch("/api/annotations").then((r) => r.json()),
  ])
    .then(([md, ann]) => {
      // Highlight annotated blocks
      const annotatedIds = new Set(ann.annotations.map((a) => a.id));
      // Blocks already rendered server-side; just mark annotated ones
      // Annotations are keyed by anchor, so we match by anchor string
      const anchorSet = new Set(
        ann.annotations.map((a) => {
          const { blockType, textHash, siblingOrdinal } = a.anchor;
          return `${blockType}:${textHash}:${siblingOrdinal}`;
        })
      );

      $$("#doc [data-anchor]").forEach((el) => {
        if (anchorSet.has(el.dataset.anchor)) {
          el.classList.add("annotated");
        }
      });

      renderAnnotations(ann.annotations);
      setStatus("Click a block to annotate");
    })
    .catch((err) => {
      setStatus("Failed to load: " + err.message);
    });

  // Click a block to annotate
  $("#doc").addEventListener("click", (e) => {
    const block = e.target.closest("[data-block-id]");
    if (!block) return;

    const anchorStr = block.dataset.anchor;
    const parts = anchorStr.split(":");
    const anchor = {
      blockType: parts[0],
      textHash: parts[1],
      siblingOrdinal: parseInt(parts[2], 10),
    };

    const comment = prompt("Add a comment for this block:");
    if (!comment) return;

    const body = {
      anchor,
      blockType: anchor.blockType,
      blockText: block.textContent.trim(),
      blockLineRange: [0, 0], // advisory, not critical
      comment,
    };

    fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then(() => {
        block.classList.add("annotated");
        return fetch("/api/annotations").then((r) => r.json());
      })
      .then((ann) => {
        renderAnnotations(ann.annotations);
        setStatus("Comment added");
      })
      .catch((err) => setStatus("Error: " + err.message));
  });

  // Done button
  doneBtn.addEventListener("click", () => {
    setStatus("Generating review…");
    fetch("/api/done", { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setStatus("Review written to: " + res.path);
        } else {
          setStatus("Error: " + res.error);
        }
      })
      .catch((err) => setStatus("Error: " + err.message));
  });

  function renderAnnotations(annotations) {
    annotationsEl.innerHTML = "";
    if (!annotations.length) {
      annotationsEl.textContent = "No annotations yet.";
      return;
    }
    annotations.forEach((a, i) => {
      const div = document.createElement("div");
      div.className = "annotation-item";
      const statusClass = "status-" + a.status;
      div.innerHTML =
        `<strong>#${i + 1}</strong> <span class="${statusClass}">[${a.status}]</span> — ` +
        escapeHtml(a.comment);
      annotationsEl.appendChild(div);
    });
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
  }
})();
