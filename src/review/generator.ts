import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import type { Relocated } from "../server/anchoring";

// ---------------------------------------------------------------------------
// Comment sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a comment body so it can be safely embedded in an HTML comment.
 *
 * Replaces `--` with `- -` (space-separated) so that `-->` can never appear
 * inside the comment body. Idempotent: running twice produces the same result.
 */
export function sanitizeComment(text: string): string {
  return text.replace(/--/g, "- -");
}

// ---------------------------------------------------------------------------
// Block type display names
// ---------------------------------------------------------------------------

function blockTypeLabel(type: string): string {
  switch (type) {
    case "heading":
      return "Heading";
    case "paragraph":
      return "Paragraph";
    case "listItem":
      return "List item";
    case "code":
      return "Code block";
    case "blockquote":
      return "Blockquote";
    case "tableCell":
      return "Table cell";
    default:
      return type;
  }
}

// ---------------------------------------------------------------------------
// Line range formatting
// ---------------------------------------------------------------------------

function formatLineRange(lineRange: [number, number]): string {
  const [start, end] = lineRange;
  if (start === end) {
    return `~line ${start}`;
  }
  return `~lines ${start}-${end}`;
}

// ---------------------------------------------------------------------------
// Summary section generation
// ---------------------------------------------------------------------------

interface NumberedAnnotation {
  number: number;
  annotation: Relocated["annotation"];
  block: Relocated["block"];
}

interface OrphanedAnnotation {
  number: number;
  annotation: Relocated["annotation"];
}

function buildSummarySections(
  fileBasename: string,
  numbered: NumberedAnnotation[],
  orphans: OrphanedAnnotation[]
): string {
  const totalAnnotations = numbered.length + orphans.length;
  const lines: string[] = [];

  lines.push(`# Review of ${fileBasename}`);
  lines.push("");
  lines.push(`**Total annotations:** ${totalAnnotations}`);
  lines.push("");

  // Regular annotations section
  if (numbered.length > 0) {
    lines.push("## Annotations");
    lines.push("");

    for (const { number, annotation } of numbered) {
      const typeLabel = blockTypeLabel(annotation.blockType);
      const lineRange = formatLineRange(annotation.blockLineRange);

      // Heading entries include the heading text as context
      if (annotation.blockType === "heading") {
        const shortContext = annotation.blockText.length > 60
          ? annotation.blockText.slice(0, 57) + "..."
          : annotation.blockText;
        lines.push(`### ${number}. ${typeLabel}: "${shortContext}" (${lineRange})`);
      } else {
        lines.push(`### ${number}. ${typeLabel} (${lineRange})`);
      }

      lines.push("");
      lines.push(`> ${annotation.comment}`);
      lines.push("");
    }
  } else {
    lines.push("## Annotations");
    lines.push("");
  }

  // Orphaned annotations section
  if (orphans.length > 0) {
    lines.push("## Unresolved / orphaned annotations");
    lines.push("");
    lines.push("These annotations could not be re-located in the current document:");
    lines.push("");

    for (const { number, annotation } of orphans) {
      const typeLabel = blockTypeLabel(annotation.blockType);
      const lineRange = formatLineRange(annotation.blockLineRange);
      lines.push(`### O${number}. (was ${typeLabel}, ${lineRange})`);
      lines.push("");
      lines.push(`> ${annotation.comment}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Inline marker insertion
// ---------------------------------------------------------------------------

/**
 * Determine the insertion string for a marker at a given block type.
 *
 * - heading/listItem: inline trailing marker (space + comment)
 * - paragraph/code/other: own line after the block (newline + comment)
 *
 * The insertion is placed AT the block's endOffset (which points to the
 * character immediately after the block's content, typically a newline).
 */
function buildMarkerInsertion(number: number, sanitized: string, blockType: string): string {
  const marker = `<!-- Review: [${number}] ${sanitized} -->`;

  if (blockType === "heading" || blockType === "listItem") {
    // Trailing inline on the same line
    return ` ${marker}`;
  }

  // Own line after the block (insert \n before the marker, before the existing \n)
  return `\n${marker}`;
}

function spliceMarkers(source: string, numbered: NumberedAnnotation[]): string {
  if (numbered.length === 0) {
    return source;
  }

  // Build insertion points: (offset, insertion string)
  const insertions: { offset: number; number: number; insertion: string }[] = [];

  for (const { number, annotation, block } of numbered) {
    if (!block) continue; // orphaned, skip inline marker
    const sanitized = sanitizeComment(annotation.comment);
    const insertion = buildMarkerInsertion(number, sanitized, annotation.blockType);
    insertions.push({ offset: block.endOffset, number, insertion });
  }

  // Sort: by offset descending, then by number descending (so at same offset,
  // higher-numbered markers are inserted first, resulting in ascending order
  // left-to-right in the output)
  insertions.sort((a, b) => {
    if (a.offset !== b.offset) return b.offset - a.offset;
    return b.number - a.number;
  });

  // Insert from end to start so offsets remain valid
  let result = source;
  for (const { offset, insertion } of insertions) {
    result = result.slice(0, offset) + insertion + result.slice(offset);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal: prepare numbered and orphaned lists
// ---------------------------------------------------------------------------

function prepareAnnotations(relocated: Relocated[]): {
  numbered: NumberedAnnotation[];
  orphans: OrphanedAnnotation[];
} {
  // Separate into non-orphaned (numbered) and orphaned
  const nonOrphaned: Relocated[] = relocated.filter(
    (r) => r.block !== null && r.annotation.status !== "orphaned"
  );
  const orphaned: Relocated[] = relocated.filter(
    (r) => r.block === null || r.annotation.status === "orphaned"
  );

  // Sort non-orphaned by endOffset (source order), then by createdAt for stability
  nonOrphaned.sort((a, b) => {
    const offsetDiff = (a.block?.endOffset ?? 0) - (b.block?.endOffset ?? 0);
    if (offsetDiff !== 0) return offsetDiff;
    return a.annotation.createdAt - b.annotation.createdAt;
  });

  // Assign numbers
  const numbered: NumberedAnnotation[] = nonOrphaned.map((r, i) => ({
    number: i + 1,
    annotation: r.annotation,
    block: r.block,
  }));

  const orphans: OrphanedAnnotation[] = orphaned.map((r, i) => ({
    number: i + 1,
    annotation: r.annotation,
  }));

  return { numbered, orphans };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the full `_reviewed.md` content by splicing review comments into
 * the original source string.
 *
 * @param source - Original markdown source
 * @param relocated - Output of `relocate()` with resolved blocks
 * @param fileBasename - Display name for the summary header (e.g. "proposal.md")
 * @returns The complete `_reviewed.md` string
 */
export function generateReview(
  source: string,
  relocated: Relocated[],
  fileBasename = "document.md"
): string {
  const { numbered, orphans } = prepareAnnotations(relocated);

  // Build summary
  const summary = buildSummarySections(fileBasename, numbered, orphans);

  // Build spliced document
  const splicedDoc = spliceMarkers(source, numbered);

  // Combine
  return `${summary}\n---\n\n<!-- Full document with inline review comments. Line numbers above are advisory. -->\n\n${splicedDoc}`;
}

/**
 * Convenience wrapper: compute output path, generate review, write to disk.
 *
 * @param sourcePath - Path to the original source file
 * @param source - Original markdown source string
 * @param relocated - Output of `relocate()` with resolved blocks
 * @returns The path to the written `_reviewed.md` file
 */
export async function writeReview(
  sourcePath: string,
  source: string,
  relocated: Relocated[]
): Promise<string> {
  const sourceDir = dirname(sourcePath);
  const sourceBase = basename(sourcePath);
  const nameWithoutExt = sourceBase.replace(/\.md$/, "");
  const outputBasename = `${nameWithoutExt}_reviewed.md`;
  const outputPath = join(sourceDir, outputBasename);

  const { numbered, orphans } = prepareAnnotations(relocated);

  const summary = buildSummarySections(sourceBase, numbered, orphans);
  const splicedDoc = spliceMarkers(source, numbered);
  const content = `${summary}\n---\n\n<!-- Full document with inline review comments. Line numbers above are advisory. -->\n\n${splicedDoc}`;

  // Ensure output directory exists
  await mkdir(sourceDir, { recursive: true });

  await writeFile(outputPath, content, "utf-8");

  return outputPath;
}
