# Phase 2 — Markdown service: relative link detection

**Status:** `TODO`
**Depends on:** Phase 1 (Server per-file state)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

The markdown renderer outputs standard `<a href="...">` links. We need to detect relative `.md` links, resolve them against the directory of the file that contains the link (standard Markdown behavior), convert the resolved path to a key relative to the session root, and mark the rendered link as "navigational" so the frontend can intercept clicks.

## Implementation

### 1. Link detection function

Add to `src/server/markdown-service.ts`:

```ts
/**
 * Detect relative .md links in a markdown source and resolve them
 * to file keys relative to the session root.
 */
export async function detectMdLinks(
  source: string,
  opts: { currentFileDir: string; sessionRoot: string }
): Promise<MdLink[]> {
  // Parse the mdast tree, find link nodes where:
  // - url path ends with .md (case-insensitive), allowing #hash but not ?query
  // - url is relative (no scheme, no leading /)
  // - decoded/resolved path is an existing regular file
  // - resolved path is normalized with realpath before key generation
  // Return array of { originalUrl, resolvedKey, resolvedPath }
}

export interface MdLink {
  originalUrl: string;   // the href as written in markdown
  resolvedKey: FileKey;  // relative to sessionRoot
  resolvedPath: string;  // absolute path
}
```

### 2. Post-processing pass

While converting mdast to hast, add `data-md-link` attributes to navigational link nodes before `toHtml()` renders the document. Avoid regex/post-processing of final HTML; it is fragile for duplicate links, entity-encoded hrefs, and title attributes.

If implementation simplicity requires a separate helper, it should still operate on the AST/hast tree, not by searching rendered HTML strings.

```ts
export async function markNavigationalLinks(
  tree: Root,
  opts: { currentFileDir: string; sessionRoot: string }
): Promise<{ links: MdLink[] }> {
  // 1. Visit mdast link nodes
  // 2. Filter to relative .md links
  // 3. Resolve each against opts.currentFileDir
  // 4. realpath + require existing regular file
  // 5. Compute resolvedKey = relative(opts.sessionRoot, resolvedPath)
  // 6. Set node.data.hProperties["data-md-link"] = resolvedKey
  // 7. Return valid links
}
```

The `data-md-link` attribute carries the file key. Frontend will intercept clicks on `[data-md-link]`.

### 3. Update parseDocument / loadDocument

Add optional `sessionRoot` and `currentFileDir` parameters:

```ts
export async function loadDocument(
  path: string,
  opts?: { sessionRoot?: string; currentFileDir?: string }
): Promise<{
  source: string;
  fileHash: string;
  blocks: BlockNode[];
  fullHtml: string;
  links: MdLink[];  // NEW
}>
```

If either option is not provided, `links` is empty and no navigation attributes are added (backward compatible).

### 4. Update server route

In `GET /api/files/:key`:
- Load the document with `sessionRoot` equal to the entry directory and `currentFileDir` equal to `dirname(resolvedPath)`
- Return `links`, `fullHtml`, and `blocks`

## Acceptance criteria

- [ ] `detectMdLinks` correctly identifies relative `.md` links and resolves them against the current file directory
- [ ] Links with schemes (`http://`, `mailto:`) are NOT marked as navigational
- [ ] Links without `.md` extension are NOT marked; `.MD` is accepted case-insensitively
- [ ] Absolute paths (`/absolute/path.md`) are NOT marked
- [ ] `data-md-link` attribute is added via AST/hast properties, not string replacement on rendered HTML
- [ ] `loadDocument` returns `links` array and `fullHtml` contains marked navigational links
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/server/markdown-service.ts` — add link detection
- `src/shared/types.ts` — add `MdLink` interface
