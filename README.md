# markdown-reviewer

A CLI tool to annotate markdown documents in your browser, producing a structured review file an LLM agent can act on.

## Goal

Review a markdown file by clicking on blocks (headings, paragraphs, list items, table cells, etc.) and attaching comments — suggestions, questions, or instructions. When the review is complete, a `_reviewed.md` file is generated alongside the original, containing both a summary of all annotations and the full document with inline review comments.

This lets you tell an LLM agent: *"read the review of this markdown and apply the necessary changes."*

## How It Works

```
mdr path/to/document.md
```

1. **Server spins up** — A Bun HTTP server starts on `localhost`. By default it auto-selects a free port and prints the URL; override with `--port`.
2. **Browser opens** — Your default browser opens to a markdown editor view of the file.
3. **Annotate blocks** — Click any annotatable block (heading, paragraph, list item, table cell, code block, blockquote, etc.) to open a modal where you can add, edit, or delete a comment.
4. **See what's annotated** — Annotated blocks are visually highlighted with a subtle overlay so you can track your progress.
5. **Annotations persist** — Each annotation is saved as a small JSON file in a temp directory. If the server crashes or you close the browser, your annotations are safe and can be resumed.
6. **Finish the review** — Click **Done** in the toolbar. The server generates the `_reviewed.md` file, **confirms success to the browser**, and only then shuts down. If generation fails, the UI stays up and reports the error.

### Block Anchoring (the load-bearing detail)

Annotations must survive reparses and *some* editing of the source file. Rather than relying on raw AST node identity (unstable) or line numbers alone (shift on any upstream edit), each annotation is anchored by a **composite key**:

```
blockType : normalizedTextHash : siblingOrdinal
```

- **`blockType`** — the mdast node type (`heading`, `paragraph`, `listItem`, `tableCell`, `code`, `blockquote`, …).
- **`normalizedTextHash`** — a short hash of the block's text content after normalization (collapse internal whitespace, trim, lowercase for headings). This makes the anchor robust to reflowing/whitespace edits.
- **`siblingOrdinal`** — the block's index within its **immediate** parent container (the value `unist-util-visit` hands the visitor directly). Scoped to the immediate parent, not the document: items in a nested sublist number independently of the outer list. This disambiguates identical content (e.g. two `- Item one` list items) and survives edits to *other* blocks.

Line numbers are still recorded, but treated as **advisory only** — they're displayed for human context and are not trusted for re-location, because they go stale the moment the agent edits the file.

**Re-location on resume:** when reparsing, an annotation is matched if its composite key is found. If the exact key is missing (content changed), the matcher falls back to `blockType + siblingOrdinal` and flags the annotation as **stale** (shown with a warning in the UI). If neither matches, the annotation is **orphaned** — preserved in storage and surfaced in a sidebar so the user can reattach or discard it, never silently dropped.

### Source Fidelity (never re-serialize)

The review generator **splices comments into the original source string** — it never regenerates markdown from the AST via `remark-stringify`. Re-serializing would reflow tables, normalize bullets and whitespace, and produce a noisy diff. The AST is used only to locate byte/line offsets; all output is built from the original text with comments inserted at block boundaries.

### Comment Encoding (avoid corrupting the document)

Inline review markers use HTML comments, which requires care:

- **Comment bodies are sanitized** — any `-->` (or `--`) sequence in user text is escaped before insertion so it can't terminate the HTML comment early and corrupt the document.
- **Fenced code blocks are annotated at the block level only** — a marker is placed *after* the closing fence, never inside it (a `<!-- -->` inside code would render as literal text). Blocks that already contain `<!-- -->` are handled by the same escaping rules.
- Markers are kept on their own line where the block structure allows, to minimize diff noise.

### Annotatable vs. Non-Annotatable Blocks

- **Annotatable:** headings, paragraphs, list items, table cells, code blocks, blockquotes, image/link references at block level.
- **Skipped:** YAML/TOML frontmatter (a positioned `yaml`/`toml` node via `remark-frontmatter`), thematic breaks (`---`), and raw HTML blocks. These can't be clicked.
- **List items:** anchor on the `listItem` node and skip the `paragraph` mdast wraps its content in — `remark-rehype` drops that `<p>` in tight lists, so an id placed on it would have no DOM element to attach to.

### Session Resumption

Annotations are stored in a structured temp directory:

```
/tmp/markdown-review/annotations/<filename>-<file-hash>/<annotation-id>.json
```

- Each annotation is its own JSON file, so individual annotations can be recovered even if the session is interrupted.
- Re-running `mdr` on the same file **auto-resumes** with existing annotations, re-locating each block via the composite anchor (see above). Changed-but-found blocks are marked stale; unfound blocks become orphans.
- `mdr <file> --fresh` discards any existing session for that file and starts clean.
- **Concurrency:** a lock file in the session directory prevents two `mdr` processes from editing the same session. A second invocation on a locked session refuses to start (with a message pointing at the running instance).

## Installation

```bash
npm install -g markdown-reviewer
# or
npx markdown-reviewer
```

Requires [Bun](https://bun.sh) runtime.

## Usage

```bash
mdr path/to/document.md [options]
```

### Options

| Option       | Default                     | Description                                          |
| ------------ | --------------------------- | ---------------------------------------------------- |
| `--port`     | auto (free port)            | Port for the local server; auto-selected if omitted  |
| `--tmp-dir`  | `/tmp/markdown-review`      | Directory for annotation session storage             |
| `--no-open`  |                             | Don't auto-open the browser                          |
| `--fresh`    |                             | Discard any existing session and start clean         |

### Example

```bash
mdr docs/proposal.md --port 8080
```

## Output

Running `mdr docs/proposal.md` produces `docs/proposal_reviewed.md`:

```markdown
# Review of proposal.md

**Total annotations:** 3

## Annotations

### 1. Heading: "Introduction" (~lines 1-2)

> Clarify the target audience in the first sentence.

### 2. Paragraph (~lines 5-8)

> This section needs more concrete examples. Consider adding a table comparing approaches.

### 3. List item (~line 12)

> Is this still accurate? The API changed in v2.

---

<!-- Full document with inline review comments. Line numbers above are advisory. -->

# Introduction <!-- Review: [1] Clarify the target audience in the first sentence. -->

Some introductory text here...

A longer paragraph with several sentences
that spans multiple lines.
<!-- Review: [2] This section needs more concrete examples... -->

- Item one
- Item two <!-- Review: [3] Is this still accurate? The API changed in v2. -->
- Item three
```

The file contains:
- A **summary section** at the top for quick scanning (all annotations listed with block context and advisory line numbers).
- The **full original document** (byte-for-byte, comments spliced in) with inline `<!-- Review: [N] ... -->` comments placed after each annotated block.

## Architecture

```
┌─────────────┐     HTTP      ┌──────────────────┐
│   CLI (mdr) │ ────────────> │  Bun HTTP Server  │
└─────────────┘               └────────┬─────────┘
                                       │ serves prerendered HTML
                                       ▼
                              ┌──────────────────┐
                              │  Browser page     │
                              │  (no build step:  │
                              │   inline vanilla  │
                              │   JS, served by   │
                              │   Bun)            │
                              └────────┬─────────┘
                                       │ fetch API
                                       ▼
                              ┌──────────────────┐
                              │  Annotation       │
                              │  Service (temp    │
                              │  JSON files)      │
                              └──────────────────┘
```

There is **no frontend build step**. The server parses the markdown (server-side, with `unified`), renders the annotatable blocks to HTML with `data-block-id` attributes, and serves a single page plus a small inline vanilla-JS/Web-Components bundle. Interactivity is limited to "click block → modal → save," which doesn't justify a framework or a Vite/dist pipeline. (If a bundling step is ever needed, use `Bun.build` so Bun remains the only toolchain — do not add Vite.)

### Components

| Layer        | Tech                          | Role                                          |
| ------------ | ----------------------------- | --------------------------------------------- |
| **CLI**      | TypeScript + Bun              | Parse args, pick port, launch server, open browser |
| **Server**   | Bun HTTP (stdlib)             | Parse markdown, serve prerendered page, API routes, file I/O |
| **Frontend** | Vanilla JS (no build)         | Click-to-annotate, modals, highlight overlay  |
| **Parser**   | unified + remark (see stack)  | Parse markdown AST, render clickable blocks   |
| **Storage**  | Temp JSON files               | Persist annotations per session               |
| **Generator**| TypeScript                    | Splice comments into source → `_reviewed.md`  |

### remark/unified stack (verified)

The parser is the unified v11 / mdast v4 generation (ESM-only — Bun handles this natively). Exact packages:

| Package | Purpose |
| --- | --- |
| `unified` ^11 | Processor pipeline |
| `remark-parse` ^11 | Markdown → mdast |
| `remark-gfm` ^4 | **Required** — tables (annotatable per the example), strikethrough, task lists. Plain CommonMark won't parse them |
| `remark-frontmatter` ^5 | Surfaces YAML/TOML as a positioned `yaml`/`toml` node so we can explicitly skip it |
| `remark-rehype` + `hast-util-to-html` | mdast → HTML for the clickable page |
| `mdast-util-to-string` | Clean text extraction for the anchor hash |
| `unist-util-visit` | Tree walking; its `(node, index, parent)` signature gives `siblingOrdinal` for free |
| `@types/mdast` ^4 | Types |

> Note: `remark-gfm`, `remark-rehype`, and `remark-frontmatter` are **separate npm packages** — the remark monorepo itself only ships `remark`, `remark-parse`, `remark-stringify`, and `remark-cli`.
>
> `remark-stringify` is intentionally **not** a dependency: the generator splices into source and never re-serializes the AST.

### How we leverage remark (verified against v11)

- **Single-pass clickable render via `hProperties`.** A small plugin walks the mdast tree and sets `node.data.hProperties['data-block-id']` (and the serialized anchor) on each annotatable node. One `remark-rehype` → `hast-util-to-html` pass then emits the whole document as HTML with `data-block-id` already on every clickable element (`<h1 data-block-id="b0">…`). This is why no frontend framework or build step is needed.
  - **Caveat (verified):** mdast wraps each `listItem`'s content in a `paragraph`, but `remark-rehype` drops that `<p>` in *tight* lists — so an id stamped on the inner paragraph disappears from the HTML. Anchor on the `listItem` itself and skip its wrapped paragraph, or you'll mint phantom ids that don't exist in the DOM.
- **Exact source offsets for splicing.** Every node's `position.start/end.offset` is an absolute, contiguous index into the source string. The generator inserts `<!-- Review -->` markers at `position.end.offset` — no line-based heuristics. (Line numbers remain advisory display only.)
- **Anchor text hash via `mdast-util-to-string`.** Use it for the normalized `textHash`, but compute it from the node's **own inline text only** — on a container like `listItem` it otherwise concatenates nested sublist text (e.g. `"nested parentdeep adeep btwo"`), which would make the hash shift when unrelated children change.
- **`siblingOrdinal` = the visitor's `index`.** `unist-util-visit`'s `(node, index, parent)` yields the index within the *immediate* parent, so ordinals are naturally scoped to the containing list/table/row — nested sublist items number independently of the outer list. (This resolves the parent-scoping question: ordinal is **per immediate parent**, not per document.)
- **Frontmatter is a real node, not a gap.** With `remark-frontmatter`, YAML/TOML appears as a positioned `yaml`/`toml` top-level node, so the "skip" rule is an explicit `type` check rather than offset guesswork.

### Project Structure

```
markdown-reviewer/
├── src/
│   ├── cli/
│   │   └── index.ts              # CLI entry — arg parsing, port selection, server launch, browser open
│   ├── server/
│   │   ├── index.ts              # Bun HTTP server — routes, page rendering, static serving
│   │   ├── markdown-service.ts   # Read markdown, compute file hash, parse AST, render blocks to HTML
│   │   ├── anchoring.ts          # Composite block-anchor computation + re-location/orphan logic
│   │   └── annotation-service.ts # CRUD for annotation JSON files, session + lock management
│   ├── frontend/
│   │   ├── page.html             # Page template (blocks injected server-side)
│   │   └── app.js                # Inline vanilla JS: click handling, modal, fetch, overlay
│   ├── review/
│   │   └── generator.ts          # Splices comments into source → _reviewed.md
│   └── shared/
│       └── types.ts              # Shared types (Annotation, BlockNode, BlockAnchor, etc.)
├── public/                       # Static assets (favicon, css)
├── package.json
├── tsconfig.json
├── bunfig.toml                   # Bun config
└── README.md
```

### Data Model

```typescript
interface BlockAnchor {
  blockType: string;       // mdast node type: "heading" | "paragraph" | "listItem" | "tableCell" | "code" | ...
  textHash: string;        // short hash of normalized block text
  siblingOrdinal: number;  // index among same-type siblings under the same parent
}

interface BlockNode {
  id: string;              // ephemeral per-render id, exposed to the DOM as data-block-id
  anchor: BlockAnchor;     // stable, persisted with the annotation
  type: string;
  text: string;
  lineRange: [number, number]; // advisory only — for display, not re-location
  html: string;            // server-rendered HTML for this block
}

interface Annotation {
  id: string;              // short hash, also the JSON filename
  anchor: BlockAnchor;     // how we re-find the block on resume
  blockType: string;       // denormalized for the review summary
  blockText: string;       // original text snapshot (context in review file + stale detection)
  blockLineRange: [number, number]; // advisory snapshot at creation time
  comment: string;         // user's annotation text
  status: "ok" | "stale" | "orphaned"; // re-location result on last load
  createdAt: number;
  updatedAt: number;
}
```

### Server API

| Method   | Endpoint                | Description                                      |
| -------- | ----------------------- | ------------------------------------------------ |
| `GET`    | `/`                     | Serve the prerendered page (blocks + inline JS)  |
| `GET`    | `/api/markdown`         | Return source markdown + parsed blocks           |
| `GET`    | `/api/annotations`      | Return all annotations (with re-location status) |
| `POST`   | `/api/annotations`      | Create or update an annotation                   |
| `DELETE` | `/api/annotations/:id`  | Remove an annotation                             |
| `POST`   | `/api/done`             | Generate `_reviewed.md`; on success, shut down   |

### Annotation Temp File Format

Each annotation is stored as a standalone JSON file (internal format — machine-friendly, lossless, no re-parsing of a hand-rolled markdown format):

```json
{
  "id": "abc123",
  "anchor": { "blockType": "heading", "textHash": "9f2a", "siblingOrdinal": 0 },
  "blockType": "heading",
  "blockText": "# Introduction",
  "blockLineRange": [1, 2],
  "comment": "Clarify the target audience in the first sentence.",
  "status": "ok",
  "createdAt": 1733251200000,
  "updatedAt": 1733251200000
}
```

### Review Generator

On `POST /api/done`, the generator:

1. Reads the **original source markdown** as a string.
2. Loads all annotations from the session directory, re-locating each block via its composite anchor; sorts by source position.
3. Builds `_reviewed.md` by **splicing into the original source string** (never re-serializing the AST):
   - A **summary section** listing each annotation with block type, advisory line numbers, and comment.
   - A **separator** (`---`).
   - The **full original document** with sanitized inline `<!-- Review: [N] comment -->` markers inserted at each annotated block boundary (after the closing fence for code blocks).
   - **Orphaned annotations** are listed in the summary under a clearly labeled "Unresolved / orphaned" subsection rather than dropped.
4. Writes the file to `<source-dir>/<basename>_reviewed.md`.
5. Returns success to the frontend; the server shuts down **only after** the write succeeds. On failure it returns an error and stays running.

## Development

```bash
# Install dependencies
bun install

# Type-check
bun run typecheck

# Run locally (no build step required)
bun run start path/to/file.md

# Watch mode (server restart on change)
bun run dev path/to/file.md
```

### ESM / tsconfig note

The remark/unified v11 stack is **ESM-only** — there is no CommonJS build. Bun runs ESM natively, so there's no bundler or transpile step, but `tsconfig.json` must be configured for it or imports won't resolve:

```jsonc
{
  "compilerOptions": {
    "module": "esnext",            // or "preserve"
    "moduleResolution": "bundler", // resolves the packages' "exports" field correctly
    "target": "esnext",
    "types": ["bun-types"],        // Bun globals (Bun.serve, etc.)
    "verbatimModuleSyntax": true,  // keep `import`/`export` as-authored
    "strict": true,
    "skipLibCheck": true
  }
}
```

`package.json` must also declare `"type": "module"`. Import with extensionless specifiers (the packages resolve via their `exports` maps); do **not** add `.js`/`.ts` extensions to bare package imports, and don't expect `require()` to work for any remark package.

## Future Improvements

- **Annotation types** — Distinguish between suggestions, questions, and informational notes.
- **File watch** — Warn live if the source file changes during an active session (beyond resume-time stale detection).
- **Multi-file reviews** — Review multiple files in a single session.
- **Diff view** — Preview how the reviewed document will look before exporting.
- **Reattach UI** — Drag an orphaned annotation onto a block to re-anchor it.
- **Collaboration** — Share annotation sessions via the temp file structure.
