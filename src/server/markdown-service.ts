import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import { toHtml } from "hast-util-to-html";
import { visit } from "unist-util-visit";
import { resolve, dirname, relative } from "node:path";
import { realpath, stat } from "node:fs/promises";
import type { BlockNode, MdLink, FileKey } from "../shared/types";
import { computeAnchor, serializeAnchor } from "./anchoring";

const ANNOTATABLE_TYPES = new Set([
  "heading",
  "paragraph",
  "listItem",
  "tableCell",
  "code",
  "blockquote",
]);

const SKIP_TYPES = new Set(["yaml", "toml", "thematicBreak", "html"]);

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Extract plain text from a node for display purposes.
 */
function nodeText(node: any): string {
  if (node.type === "code") return node.value ?? "";
  if (node.type === "text") return node.value ?? "";
  const children = node.children ?? [];
  return children.map((c: any) => nodeText(c)).join("");
}

/**
 * Collect annotatable nodes in document order, computing anchors and ids.
 */
function collectAnnotatable(tree: any) {
  const results: { node: any; id: string; anchor: any; anchorStr: string }[] = [];
  let idCounter = 0;

  // First pass: find all container nodes so we can skip their wrapped paragraphs
  const containerSet = new Set<any>();
  visit(tree, "listItem", (node: any) => {
    containerSet.add(node);
  });
  visit(tree, "blockquote", (node: any) => {
    containerSet.add(node);
  });

  // Second pass: stamp annotatable nodes
  visit(tree, (node: any, index: number | undefined, parent: any) => {
    const type = node.type;

    // Skip non-annotatable and explicitly skipped types
    if (SKIP_TYPES.has(type) || !ANNOTATABLE_TYPES.has(type)) return;

    // Skip paragraphs that are direct children of container nodes (listItem, blockquote)
    // remark-rehype drops <p> in tight lists; blockquote wraps its content in <p>
    if (type === "paragraph" && parent && containerSet.has(parent)) return;

    const id = `b${idCounter++}`;
    const anchor = computeAnchor(node, index);
    const anchorStr = serializeAnchor(anchor);

    // Stamp hProperties so remark-rehype puts them on the HTML element
    if (!node.data) node.data = {};
    if (!node.data.hProperties) node.data.hProperties = {};
    node.data.hProperties["data-block-id"] = id;
    node.data.hProperties["data-anchor"] = anchorStr;
    const startPos = node.position?.start ?? { line: 0, column: 0, offset: 0 };
    const endPos = node.position?.end ?? { line: 0, column: 0, offset: 0 };
    node.data.hProperties["data-line-range"] = JSON.stringify([startPos.line, endPos.line]);

    results.push({ node, id, anchor, anchorStr });
  });

  return results;
}

/**
 * Render a single mdast node to an HTML fragment with data attributes injected.
 * Renders the node's source slice, then injects data-block-id and data-anchor.
 */
function renderNodeToHtml(node: any, source: string, id: string, anchorStr: string): string {
  const startOffset = node.position?.start?.offset ?? 0;
  const endOffset = node.position?.end?.offset ?? 0;
  const sourceSlice = source.slice(startOffset, endOffset);

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkRehype, { allowDangerousHtml: true });

  const tree = processor.parse(sourceSlice);
  const hast = processor.runSync(tree);
  let html = toHtml(hast, { allowDangerousHtml: true }).trim();

  // Inject data attributes into the appropriate tag
  const attrs = `data-block-id="${id}" data-anchor="${anchorStr}"`;
  const type = node.type;

  if (type === "heading") {
    // <h1>...</h1> → <h1 data-block-id="..." data-anchor="...">...</h1>
    html = html.replace(/<(h[1-6])([^>]*>)/, (_m, tag, close) => `<${tag} ${attrs}${close}`);
  } else if (type === "paragraph") {
    html = html.replace(/<(p)([^>]*>)/, (_m, tag, close) => `<${tag} ${attrs}${close}`);
  } else if (type === "listItem") {
    // Source slice for a list item parses as <ul><li>...</li></ul>
    // We need just the <li> with attributes
    const liMatch = html.match(/<li([^>]*)>/);
    if (liMatch) {
      // Extract just the <li>...</li> from the <ul> wrapper
      const liContentMatch = html.match(/<li[^>]*>([\s\S]*?)<\/li>/);
      if (liContentMatch) {
        html = `<li ${attrs}>${liContentMatch[1]}</li>`;
      }
    }
  } else if (type === "code") {
    // <pre><code>...</code></pre> → inject on <pre>
    html = html.replace(/<(pre)([^>]*>)/, (_m, tag, close) => `<${tag} ${attrs}${close}`);
  } else if (type === "blockquote") {
    html = html.replace(/<(blockquote)([^>]*>)/, (_m, tag, close) => `<${tag} ${attrs}${close}`);
  } else if (type === "tableCell") {
    // Source slice for a tableCell is just the cell text with | delimiters.
    // It doesn't parse as a table, so construct HTML manually.
    const isHeader = (node as any).isHeader ?? false;
    const tag = isHeader ? "th" : "td";
    const cellText = nodeText(node);
    html = `<${tag} ${attrs}>${escapeHtml(cellText)}</${tag}>`;
  }

  return html;
}

// ---------------------------------------------------------------------------
// Link detection
// ---------------------------------------------------------------------------

/** Check if a URL is a navigational relative .md link. */
function isNavigationalLink(url: string): boolean {
  // Strip hash fragment
  const withoutHash = url.split("#")[0];
  // No query strings allowed
  if (withoutHash.includes("?")) return false;
  // No URI scheme (e.g. http://, mailto:)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false;
  // No absolute paths
  if (withoutHash.startsWith("/")) return false;
  // Must end with .md (case-insensitive)
  if (!/\.md$/i.test(withoutHash)) return false;
  return true;
}

/** Resolve a navigational link to a file key, or return null if invalid. */
async function resolveLink(
  url: string,
  currentFileDir: string,
  sessionRoot: string,
): Promise<MdLink | null> {
  const withoutHash = url.split("#")[0];
  try {
    const resolvedPath = await realpath(resolve(currentFileDir, withoutHash));
    const s = await stat(resolvedPath);
    if (!s.isFile()) return null;
    // Normalize session root with realpath too (handles /tmp → /private/tmp etc.)
    const normalizedRoot = await realpath(sessionRoot);
    const resolvedKey = relative(normalizedRoot, resolvedPath);
    return { originalUrl: url, resolvedKey, resolvedPath };
  } catch {
    return null;
  }
}

/**
 * Detect relative .md links in a markdown source and resolve them
 * to file keys relative to the session root.
 */
export async function detectMdLinks(
  source: string,
  opts: { currentFileDir: string; sessionRoot: string },
): Promise<MdLink[]> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"]);

  const tree = processor.parse(source);
  return visitAndResolveLinks(tree, opts);
}

/** Internal: visit all link nodes in a tree and resolve navigational ones. */
async function visitAndResolveLinks(
  tree: any,
  opts: { currentFileDir: string; sessionRoot: string },
): Promise<MdLink[]> {
  // Collect unique link URLs first (visit is synchronous)
  const urls: string[] = [];
  const seen = new Set<string>();

  visit(tree, "link", (node: any) => {
    const url = node.url;
    if (!url || !isNavigationalLink(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  });

  // Resolve each link asynchronously
  const links: MdLink[] = [];
  for (const url of urls) {
    const result = await resolveLink(url, opts.currentFileDir, opts.sessionRoot);
    if (result) links.push(result);
  }

  return links;
}

/**
 * Visit mdast link nodes, mark navigational ones with data-md-link attribute,
 * and return the resolved links.
 */
export async function markNavigationalLinks(
  tree: any,
  opts: { currentFileDir: string; sessionRoot: string },
): Promise<MdLink[]> {
  // Collect link nodes with their URLs first (visit is synchronous)
  interface LinkNodeRef {
    node: any;
    url: string;
  }
  const linkRefs: LinkNodeRef[] = [];
  const seen = new Set<string>();

  visit(tree, "link", (node: any) => {
    const url = node.url;
    if (!url || !isNavigationalLink(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    linkRefs.push({ node, url });
  });

  // Resolve each link asynchronously and stamp nodes
  const links: MdLink[] = [];
  for (const { node, url } of linkRefs) {
    const result = await resolveLink(url, opts.currentFileDir, opts.sessionRoot);
    if (result) {
      links.push(result);
      // Stamp hProperties so remark-rehype renders the attribute
      if (!node.data) node.data = {};
      if (!node.data.hProperties) node.data.hProperties = {};
      node.data.hProperties["data-md-link"] = result.resolvedKey;
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// Document parsing
// ---------------------------------------------------------------------------

/**
 * Parse markdown source into blocks with HTML rendering.
 * Returns the raw source and an array of BlockNode.
 */
export function parseDocument(source: string): { source: string; blocks: BlockNode[]; fullHtml: string } {
  // allowDangerousHtml: true — acceptable risk since this tool operates on
  // local files chosen explicitly by the user, not untrusted remote content.
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .use(remarkRehype, { allowDangerousHtml: true });

  const tree = processor.parse(source);

  // Collect annotatable nodes, stamping hProperties in-place
  const collected = collectAnnotatable(tree);

  // Convert the stamped tree to HTML (full document, structurally correct)
  const hast = processor.runSync(tree);
  const fullHtml = toHtml(hast, { allowDangerousHtml: true });

  // Build BlockNode array from collected nodes
  const blocks: BlockNode[] = collected.map(({ node, id, anchor, anchorStr }) => {
    const startPos = node.position?.start ?? { line: 0, column: 0, offset: 0 };
    const endPos = node.position?.end ?? { line: 0, column: 0, offset: 0 };

    return {
      id,
      anchor,
      type: node.type,
      text: nodeText(node),
      lineRange: [startPos.line, endPos.line],
      endOffset: endPos.offset,
      html: renderNodeToHtml(node, source, id, anchorStr),
    };
  });

  return { source, blocks, fullHtml };
}

/**
 * Options for loadDocument when link detection is desired.
 */
export interface LoadDocumentOptions {
  sessionRoot?: string;
  currentFileDir?: string;
}

/**
 * Load a markdown file from disk, compute file hash, and parse.
 * When opts.sessionRoot and opts.currentFileDir are provided, navigational
 * .md links are detected and stamped with data-md-link attributes.
 */
export async function loadDocument(
  path: string,
  opts?: LoadDocumentOptions,
): Promise<{
  source: string;
  fileHash: string;
  blocks: BlockNode[];
  fullHtml: string;
  links: MdLink[];
}> {
  const source = await Bun.file(path).text();
  const fileHash = await hashSource(source);

  const hasOpts = opts?.sessionRoot && opts.currentFileDir;

  if (hasOpts) {
    // Full parse with link detection
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ["yaml", "toml"])
      .use(remarkRehype, { allowDangerousHtml: true });

    const tree = processor.parse(source);

    // Collect annotatable nodes, stamping hProperties in-place
    const collected = collectAnnotatable(tree);

    // Mark navigational links (stamps data-md-link on link nodes)
    const links = await markNavigationalLinks(tree, {
      currentFileDir: opts.currentFileDir!,
      sessionRoot: opts.sessionRoot!,
    });

    // Convert the stamped tree to HTML
    const hast = processor.runSync(tree);
    const fullHtml = toHtml(hast, { allowDangerousHtml: true });

    // Build BlockNode array from collected nodes
    const blocks: BlockNode[] = collected.map(({ node, id, anchor, anchorStr }) => {
      const startPos = node.position?.start ?? { line: 0, column: 0, offset: 0 };
      const endPos = node.position?.end ?? { line: 0, column: 0, offset: 0 };

      return {
        id,
        anchor,
        type: node.type,
        text: nodeText(node),
        lineRange: [startPos.line, endPos.line],
        endOffset: endPos.offset,
        html: renderNodeToHtml(node, source, id, anchorStr),
      };
    });

    return { source, fileHash, blocks, fullHtml, links };
  }

  // No link detection — use existing parseDocument
  const { blocks, fullHtml } = parseDocument(source);
  return { source, fileHash, blocks, fullHtml, links: [] };
}

/**
 * Compute SHA-256 hash of source string.
 */
async function hashSource(source: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(source);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
