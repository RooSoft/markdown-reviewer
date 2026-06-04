// How an annotation re-finds its block after a reparse. Persisted with each annotation.
export interface BlockAnchor {
  blockType: string;       // mdast node type: "heading" | "paragraph" | "listItem" | "tableCell" | "code" | "blockquote" | ...
  textHash: string;        // short hash of the block's OWN normalized inline text (not nested children)
  siblingOrdinal: number;  // index within the IMMEDIATE parent container (the value unist-util-visit hands the visitor)
}

// A renderable, clickable block produced per-parse by the markdown service.
export interface BlockNode {
  id: string;                  // ephemeral per-render id, exposed to the DOM as data-block-id (e.g. "b0", "b1")
  anchor: BlockAnchor;         // stable, persisted with the annotation
  type: string;                // same value as anchor.blockType, denormalized for convenience
  text: string;                // extracted block text (own inline text)
  lineRange: [number, number]; // ADVISORY ONLY — for display, never trusted for re-location
  endOffset: number;           // absolute index into the source string at this block's end (position.end.offset). The review generator splices markers here — see Phase 4. NOT advisory; load-bearing.
  html: string;                // server-rendered HTML for this block (already carries data-block-id)
}

export type FileKey = string;  // relative path from the session root (e.g. "specs/001.md")

// A relative .md link detected in a markdown file, resolved to a file key.
export interface MdLink {
  originalUrl: string;   // the href as written in markdown
  resolvedKey: FileKey;  // relative to sessionRoot
  resolvedPath: string;  // absolute path (realpath-normalized)
}

export type AnnotationStatus = "ok" | "stale" | "orphaned";

// The persisted annotation (one JSON file each).
export interface Annotation {
  id: string;                       // short hash, also the JSON filename (without .json)
  anchor: BlockAnchor;              // how we re-find the block on resume
  blockType: string;                // denormalized for the review summary
  blockText: string;                // original text snapshot (review context + stale detection)
  blockLineRange: [number, number]; // advisory snapshot at creation time
  comment: string;                  // user's annotation text
  status: AnnotationStatus;         // re-location result on last load
  createdAt: number;                // epoch ms
  updatedAt: number;                // epoch ms
}
