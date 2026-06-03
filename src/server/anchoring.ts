import type { BlockAnchor, Annotation, BlockNode, AnnotationStatus } from "../shared/types";

/**
 * FNV-1a hash (32-bit) returning hex string.
 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Normalize text for hashing:
 * - Collapse internal whitespace to single spaces, trim
 * - Lowercase for headings
 */
function normalizeText(text: string, blockType: string): string {
  let normalized = text.replace(/\s+/g, " ").trim();
  if (blockType === "heading") {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

/**
 * Extract the block's OWN inline text, excluding nested list/quote children.
 * For container nodes (listItem, blockquote), only direct inline/paragraph content is used.
 */
function extractOwnText(node: any): string {
  if (node.type === "code") {
    return (node as any).value ?? "";
  }

  if (node.type === "listItem" || node.type === "blockquote") {
    // Only extract text from direct inline content or wrapped paragraphs.
    // Skip nested list/quote children.
    const children = (node as any).children ?? [];
    const parts: string[] = [];
    for (const child of children) {
      if (child.type === "paragraph") {
        // Direct paragraph child — extract its text
        parts.push(childToText(child));
      } else if (child.type === "heading") {
        parts.push(childToText(child));
      } else if (child.type === "text") {
        parts.push(child.value ?? "");
      } else if (child.type === "inlineCode") {
        parts.push(child.value ?? "");
      } else if (child.type === "list" || child.type === "blockquote") {
        // Skip nested containers
        continue;
      } else {
        // Other inline-ish nodes
        parts.push(childToText(child));
      }
    }
    return parts.join(" ");
  }

  // For leaf nodes (paragraph, heading, tableCell), use all child text
  return childToText(node);
}

/**
 * Convert a node's children to plain text using mdast-util-to-string logic.
 */
function childToText(node: any): string {
  const children = (node as any).children ?? [];
  const parts: string[] = [];
  for (const child of children) {
    if (child.type === "text") {
      parts.push(child.value ?? "");
    } else if (child.type === "inlineCode") {
      parts.push(child.value ?? "");
    } else if (child.type === "image") {
      // Include alt text for images (parity with mdast-util-to-string)
      parts.push(child.alt ?? "");
    } else if (child.children) {
      parts.push(childToText(child));
    }
  }
  return parts.join("");
}

/**
 * Compute a composite anchor for a block node.
 * @param node - mdast node
 * @param index - sibling ordinal from unist-util-visit (index within immediate parent)
 */
export function computeAnchor(node: any, index: number | undefined): BlockAnchor {
  const blockType = node.type;
  const ownText = extractOwnText(node);
  const normalized = normalizeText(ownText, blockType);
  const textHash = fnv1a(normalized);
  const siblingOrdinal = index ?? 0;

  return { blockType, textHash, siblingOrdinal };
}

/**
 * Serialize anchor to `blockType:textHash:siblingOrdinal` string.
 */
export function serializeAnchor(anchor: BlockAnchor): string {
  return `${anchor.blockType}:${anchor.textHash}:${anchor.siblingOrdinal}`;
}

/**
 * Parse anchor from `blockType:textHash:siblingOrdinal` string.
 */
export function parseAnchor(str: string): BlockAnchor {
  const [blockType, textHash, siblingOrdinalStr] = str.split(":");
  return {
    blockType,
    textHash,
    siblingOrdinal: parseInt(siblingOrdinalStr, 10),
  };
}

/**
 * The binding relocate computed for one annotation.
 * `block` is null iff orphaned.
 */
export interface Relocated {
  annotation: Annotation;
  block: BlockNode | null;
}

/**
 * Relocate annotations to current blocks using four-tier matching.
 *
 * Tiers:
 * 1. Exact composite (blockType + textHash + siblingOrdinal) → ok
 * 2. Content moved (blockType + textHash, different ordinal) → ok, rebind
 * 3. Position match, content changed (blockType + siblingOrdinal) → stale
 * 4. No match → orphaned
 *
 * One-block-one-claim. Pure function — no I/O.
 */
export function relocate(annotations: Annotation[], blocks: BlockNode[]): Relocated[] {
  // Sort annotations in stable order: by siblingOrdinal, then createdAt
  const sorted = [...annotations].sort(
    (a, b) => a.anchor.siblingOrdinal - b.anchor.siblingOrdinal || a.createdAt - b.createdAt
  );

  // Build lookup maps
  const byExact = new Map<string, BlockNode>(); // "type:hash:ordinal" -> block
  const byContent = new Map<string, BlockNode[]>(); // "type:hash" -> [blocks]
  const byPos = new Map<string, BlockNode[]>(); // "type:ordinal" -> [blocks] (multimap)

  for (const block of blocks) {
    const anchor = block.anchor;
    const exactKey = `${anchor.blockType}:${anchor.textHash}:${anchor.siblingOrdinal}`;
    const contentKey = `${anchor.blockType}:${anchor.textHash}`;
    const posKey = `${anchor.blockType}:${anchor.siblingOrdinal}`;

    byExact.set(exactKey, block);
    byContent.set(contentKey, [...(byContent.get(contentKey) ?? []), block]);
    byPos.set(posKey, [...(byPos.get(posKey) ?? []), block]);
  }

  const claimed = new Set<string>(); // block ids that are already claimed
  const results: Relocated[] = [];

  for (const annotation of sorted) {
    const anchor = annotation.anchor;
    let boundBlock: BlockNode | null = null;
    let status: AnnotationStatus = "orphaned";

    // Tier 1: Exact composite match
    const exactKey = `${anchor.blockType}:${anchor.textHash}:${anchor.siblingOrdinal}`;
    const exactMatch = byExact.get(exactKey);
    if (exactMatch && !claimed.has(exactMatch.id)) {
      boundBlock = exactMatch;
      status = "ok";
    }

    // Tier 2: Content moved (same type + hash, different ordinal)
    if (!boundBlock) {
      const contentKey = `${anchor.blockType}:${anchor.textHash}`;
      const candidates = byContent.get(contentKey) ?? [];
      const unclaimed = candidates.filter((b) => !claimed.has(b.id));

      if (unclaimed.length > 0) {
        // Pick nearest ordinal
        unclaimed.sort(
          (a, b) =>
            Math.abs(a.anchor.siblingOrdinal - anchor.siblingOrdinal) -
            Math.abs(b.anchor.siblingOrdinal - anchor.siblingOrdinal)
        );
        boundBlock = unclaimed[0];
        status = "ok";
      }
    }

    // Tier 3: Position match, content changed (multimap — pick nearest ordinal)
    if (!boundBlock) {
      const posKey = `${anchor.blockType}:${anchor.siblingOrdinal}`;
      const posCandidates = (byPos.get(posKey) ?? []).filter((b) => !claimed.has(b.id));

      if (posCandidates.length > 0) {
        posCandidates.sort(
          (a, b) =>
            Math.abs(a.anchor.siblingOrdinal - anchor.siblingOrdinal) -
            Math.abs(b.anchor.siblingOrdinal - anchor.siblingOrdinal)
        );
        boundBlock = posCandidates[0];
        status = "stale";
      }
    }

    // Clone annotation to avoid mutating input
    const resolvedAnnotation: Annotation = {
      ...annotation,
      anchor: boundBlock
        ? { ...anchor, siblingOrdinal: boundBlock.anchor.siblingOrdinal }
        : { ...anchor },
      status,
    };

    // Claim the block (one-block-one-claim)
    if (boundBlock) {
      claimed.add(boundBlock.id);
    }

    results.push({ annotation: resolvedAnnotation, block: boundBlock });
  }

  return results;
}
