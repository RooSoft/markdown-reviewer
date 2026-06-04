# markdown-reviewer (`mdr`)

A browser-based markdown annotation tool. Open a `.md` file, click blocks to add comments, hit **Done**, and get a `_reviewed.md` file with inline review markers — structured feedback an LLM agent can read and act on.

```
mdr proposal.md
→ browser opens → click blocks → add comments → Done → proposal_reviewed.md
```

## Usage

```bash
mdr <path-to-markdown> [options]
```

Start reviewing a markdown file. Click relative `.md` links in the rendered document to navigate to
related files and annotate them in the same session. Reviewed output is written next to each source
as `<name>.mdr`.

### Options
- `--port <n>` — Port for the local server (default: auto-select)
- `--tmp-dir <dir>` — Annotation session storage root
- `--no-open` — Don't auto-open the browser
- `--fresh` — Discard existing session, start clean
- `--auto-discover` — Crawl the relative-`.md` link graph from the entry file and map the whole cluster into the session up front

## How it works

1. **CLI** — `mdr file.md` starts a local Bun HTTP server and opens your browser.
2. **Server** — Parses the markdown into annotatable blocks (headings, paragraphs, list items, code blocks, blockquotes, table cells) and serves a single-page view.
3. **Browser** — Click any block to add or edit a comment. The sidebar shows all active and orphaned annotations.
4. **Done** — The server generates `file_reviewed.md` alongside the original, confirms success to the browser, then shuts down.

Annotations persist as JSON files and **auto-resume** on re-run. Blocks are matched by content hash (not line numbers), so annotations survive reordering and unrelated edits.

## Server API

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/markdown` | `{ source, blocks }` |
| `GET` | `/api/annotations` | `{ annotations }` |
| `POST` | `/api/annotations` | `{ annotation }` (201 create / 200 update) |
| `DELETE` | `/api/annotations/:id` | `{ ok }` or 404 |
| `POST` | `/api/done` | `{ ok, path }` or `{ ok: false, error }` |

## Output format

The `_reviewed.md` file contains:

1. **Summary section** — numbered annotations with block type, line range, and comment text. Orphaned annotations (blocks that were deleted) are listed separately.
2. **Thematic break** separator.
3. **Full original source** with inline `<!-- Review: [N] comment -->` markers spliced at each annotated block's position.

The original formatting is preserved byte-for-byte — markers are inserted into the source string, never re-serialized from an AST.

## Install

```sh
git clone <repo>
cd markdown-reviewer
bun install
```

Run against a file:

```sh
bun run start path/to/doc.md
```

Or install globally. `bun install -g .` is [broken](https://github.com/oven-sh/bun/issues) — use one of these instead:

**Option 1:** `bun link` (re-run after code changes to update the binary)

```sh
bun link
mdr path/to/doc.md
```

**Option 2:** `bun install -g` with an absolute path

```sh
bun install -g /path/to/markdown-reviewer
mdr path/to/doc.md
```

## Development

```sh
bun run dev path/to/doc.md    # watch mode
bun run typecheck             # TypeScript check
bun test                      # run tests
```

## Project structure

```
src/
├── cli/index.ts                # CLI entry point
├── frontend/
│   ├── app.js                  # Frontend (vanilla JS, no build step)
│   └── page.html               # HTML page template
├── review/
│   ├── generator.ts            # Review file generator
│   └── generator.test.ts
├── server/
│   ├── index.ts                # HTTP server + API routes
│   ├── index.test.ts
│   ├── markdown-service.ts     # Markdown parsing (remark pipeline)
│   ├── markdown-service.test.ts
│   ├── anchoring.ts            # Block anchoring + relocation
│   ├── anchoring.test.ts
│   ├── annotation-service.ts   # JSON persistence + session lock
│   └── annotation-service.test.ts
└── shared/
    └── types.ts                # Shared TypeScript types
```


