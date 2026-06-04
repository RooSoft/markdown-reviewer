# Phase 2 — Markdown service: relative link detection

**Status:** `TODO`
**Depends on:** Phase 1 (Server per-file state)
**Parent spec:** [`../002-multi-file-review.md`](../002-multi-file-review.md)

## What changes

The markdown renderer outputs standard `<a href="...">` links. We need to detect relative `.md` links, resolve them against the entry file's directory, and mark them as "navigational" so the frontend can intercept clicks.

## Implementation

### 1. Link detection function

Add to `src/server/markdown-service.ts`:

```ts
/**
 * Detect relative .md links in a markdown source and resolve them
 * to file keys relative to the base directory.
 */
export function detectMdLinks(
  source: string,
  baseDir: string
): MdLink[] {
  // Parse the mdast tree, find link nodes where:
  // - url ends with .md
  // - url is relative (no scheme, no leading /)
  // - resolved path exists on disk
  // Return array of { originalUrl, resolvedKey, resolvedPath }
}

export interface MdLink {
  originalUrl: string;   // the href as written in markdown
  resolvedKey: FileKey;  // relative to baseDir
  resolvedPath: string;  // absolute path
}
```

### 2. Post-processing pass

After `parseDocument` returns, do a pass over the `fullHtml` to add `data-md-link` attributes to navigational links:

```ts
export async function markNavigationalLinks(
  fullHtml: string,
  source: string,
  baseDir: string
): Promise<{ html: string; links: MdLink[] }> {
  // 1. Parse mdast to find link nodes
  // 2. Filter to relative .md links
  // 3. Resolve each against baseDir
  // 4. Check if resolved path exists (Bun.file(path).exists())
  // 5. In fullHtml, add data-md-link="KEY" to matching <a> tags
  // 6. Return modified HTML + list of valid links
}
```

The `data-md-link` attribute carries the file key. Frontend will intercept clicks on `[data-md-link]`.

### 3. Update parseDocument / loadDocument

Add an optional `baseDir` parameter:

```ts
export async function loadDocument(
  path: string,
  opts?: { baseDir?: string }
): Promise<{
  source: string;
  fileHash: string;
  blocks: BlockNode[];
  fullHtml: string;
  links: MdLink[];  // NEW
}>
```

If `baseDir` is not provided, `links` is empty (backward compatible).

### 4. Update server route

In `GET /api/files/:key`:
- After loading the document, call `markNavigationalLinks` with the entry dir as base
- Return `links` array alongside `blocks`

## Acceptance criteria

- [ ] `detectMdLinks` correctly identifies relative `.md` links
- [ ] Links with schemes (`http://`, `mailto:`) are NOT marked as navigational
- [ ] Links without `.md` extension are NOT marked
- [ ] Absolute paths (`/absolute/path.md`) are NOT marked
- [ ] `data-md-link` attribute is added to valid navigational links in HTML
- [ ] `loadDocument` returns `links` array
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

## Files to modify

- `src/server/markdown-service.ts` — add link detection
- `src/shared/types.ts` — add `MdLink` interface
