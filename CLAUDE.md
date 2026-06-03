# CLAUDE.md — markdown-reviewer

## Toolchain

- **Bun only** — runtime, HTTP server, package manager, test runner.
- **ESM-only remark v11 stack** — `unified`, `remark-parse`, `remark-gfm`, `remark-frontmatter`, `remark-rehype`, `hast-util-to-html`, `mdast-util-to-string`, `unist-util-visit`.
- **TypeScript** — strict, no emit.
- **tsconfig notes**: `module: esnext`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`, `noEmit: true`.
- **No Vite, no `remark-stringify`** — the server renders HTML via `remark-rehype` → `hast-util-to-html`, and the review generator splices markers directly into the original source string.

## Commands

```sh
bun install              # install dependencies
bun run typecheck        # tsc --noEmit (must be clean)
bun test                 # run all tests (must be green)
bun run start <file>     # start the tool against a markdown file
bun run dev <file>       # start with --watch for dev iteration
```

## Load-bearing invariants

These must not be accidentally broken:

1. **Composite anchor** — `blockType:textHash:siblingOrdinal`. The `textHash` is an FNV-1a hash of the block's *own* inline text (not nested children), normalized (whitespace collapsed, headings lowercased). The `siblingOrdinal` is the index within the *immediate* parent container (from `unist-util-visit`). Line numbers are advisory only — never used for relocation.

2. **Source fidelity** — the review generator splices HTML comment markers into the *original source string* at `endOffset` positions. It never re-serializes the AST. This preserves the author's exact formatting.

3. **Comment sanitization** — `sanitizeComment()` replaces `--` with `- -` so that `-->` can never appear inside a comment body and prematurely terminate the HTML comment. Markers are placed *after* closing code fences (at `endOffset`, which points past the fence).

4. **Skipped node types** — frontmatter (`yaml`, `toml`), thematic breaks (`thematicBreak`), and raw HTML (`html`) are never annotated. List items anchor on `listItem` nodes (not the `<p>` children), and paragraphs that are direct children of `listItem`/`blockquote` containers are skipped to avoid double-anchoring.

## Project structure

```
src/
├── cli/index.ts               # CLI entry: arg parsing, server launch, signal handling
├── frontend/
│   ├── app.js                 # vanilla JS frontend (IIFE, no build step)
│   └── page.html              # server-rendered HTML page template
├── review/
│   ├── generator.ts           # review generator: summary + inline marker splicing
│   └── generator.test.ts      # tests for sanitization, worked example, source fidelity
├── server/
│   ├── index.ts               # Bun HTTP server, all API routes, static serving
│   ├── index.test.ts          # integration tests for all routes
│   ├── markdown-service.ts    # parseDocument / loadDocument (remark pipeline)
│   ├── markdown-service.test.ts
│   ├── anchoring.ts           # computeAnchor, relocate (four-tier matcher)
│   ├── anchoring.test.ts
│   ├── annotation-service.ts  # JSON file persistence + session lock
│   └── annotation-service.test.ts
└── shared/
    └── types.ts               # BlockAnchor, BlockNode, Annotation, AnnotationStatus
```

## Server API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Prerendered HTML page with injected block HTML |
| GET | `/app.js` | Frontend JavaScript |
| GET | `/static/*` | Static assets from `public/` |
| GET | `/api/markdown` | `{ source, blocks }` — original source + parsed blocks |
| GET | `/api/annotations` | `{ annotations }` — persisted annotations with relocation |
| POST | `/api/annotations` | Create/update annotation → `{ annotation }` |
| DELETE | `/api/annotations/:id` | Remove annotation → `{ ok }` or 404 |
| POST | `/api/done` | Generate `_reviewed.md` → `{ ok, path }` or `{ ok: false, error }` |

## CLI flags

`mdr <file> [options]`

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | auto (0) | Port for the local server |
| `--tmp-dir <dir>` | `/tmp/markdown-review` | Root for annotation session storage |
| `--no-open` | false | Don't auto-open the browser |
| `--fresh` | false | Discard existing session, start clean |
| `-h, --help` | — | Show help |
