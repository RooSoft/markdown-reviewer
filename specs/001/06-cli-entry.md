# Phase 6 — CLI entry (args, port, launch, open)

**Status:** `TODO`
**Depends on:** Phase 1, Phase 5
**Parent spec:** [`../001-markdown-reviewer.md`](../001-markdown-reviewer.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase 6. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

Hand the cold-start `worker` exactly this context:

- **Branch:** `spec/001-markdown-reviewer` (commit here, never merge to `main`).
- **Read in full:** this file plus the root spec's Overview / Motivation / Goals / Non-goals.
- **Prior phases landed:** Phase 5 exposes `startServer({ filePath, port?, tmpDir, fresh? })` → `{ url, port, stop }` and throws a typed "session is locked by PID … (URL …)" error when a live lock is held. This phase only parses args and drives `startServer`.
- **Definition of done:** all Work items + Acceptance criteria ticked; `bun run typecheck` clean; `mdr`/`bun run start` launches and opens (or `--no-open` doesn't); committed with this file's `Status:` and the root dashboard row both `DONE`.

---

## Files touched

- `src/cli/index.ts` — arg parsing, validation, port selection delegation, server launch, browser open, signal handling

## Pre-flight check

```sh
rg -n "process.argv|--port|--tmp-dir|--no-open|--fresh|startServer" src/cli/index.ts 2>/dev/null
bun run start --help 2>/dev/null || true
```

## CLI contract

```
mdr <path-to-markdown> [options]
```

### Options (authoritative — the CLI's complete option set)

| Option | Default | Description |
| --- | --- | --- |
| `--port <n>` | auto (free port) | Port for the local server; auto-selected if omitted (delegates to Phase 5's `port: 0`). |
| `--tmp-dir <dir>` | `/tmp/markdown-review` | Root directory for annotation session storage. |
| `--no-open` | (off) | Don't auto-open the browser. |
| `--fresh` | (off) | Discard any existing session for this file and start clean. |

- The **positional argument** is the markdown file path. Required. If missing, print usage and exit non-zero.
- Validate the file exists and is readable before starting the server; a clear error + non-zero exit otherwise.
- Keep arg parsing dependency-free (hand-rolled over `process.argv`, or `Bun`'s utilities) — do not add a CLI framework; this is a single command with four flags.

## Behavior

1. Parse args; resolve the file path (absolute). Validate existence.
2. Call `startServer({ filePath, port, tmpDir, fresh })`.
   - On the typed **"locked"** error from Phase 5: print the message pointing at the running instance and exit non-zero. **Do not** start a second server.
3. On success, print the URL (e.g. `markdown-reviewer running at http://localhost:PORT`). This print is required even with `--no-open` (it's how the user reaches the page).
4. Unless `--no-open`, open the default browser to the URL. Use a cross-platform open (macOS `open`, Linux `xdg-open`, Windows `start`) via `Bun.spawn`; failure to open is non-fatal (the URL is already printed).
5. Keep the process alive while the server runs. The server shuts itself down after a successful `POST /api/done` (Phase 5); when it stops, the CLI process should exit cleanly (0).
6. Handle `SIGINT`/`SIGTERM`: release the session (call `server.stop()`, which releases the lock) and exit — so Ctrl-C never leaves a stale lock behind. (A stale lock is also self-healing via the PID-liveness check from Phase 3, but clean release is preferred.)

## Work items

- [ ] Parse positional path + `--port`, `--tmp-dir`, `--no-open`, `--fresh`; print usage and exit non-zero on missing/invalid args.
- [ ] Validate the markdown file exists/readable before launching.
- [ ] Default `--tmp-dir` to `/tmp/markdown-review`; pass through to `startServer`.
- [ ] Launch via `startServer`; print the resolved URL (always).
- [ ] Cross-platform browser open unless `--no-open`; non-fatal on failure.
- [ ] Catch the "locked" error and print the holder message + exit non-zero (no second server).
- [ ] `SIGINT`/`SIGTERM` handler → `server.stop()` → exit; exit cleanly when the server self-stops after Done.

## Acceptance criteria

- [ ] (a) `bun run typecheck` clean.
- [ ] (b) `bun run start path/to/sample.md --no-open` prints a `localhost:PORT` URL and does not open a browser; the page is reachable at that URL.
- [ ] (c) `--port 8080` binds 8080 (URL reflects it); omitting `--port` picks a free port.
- [ ] (d) Running a second instance on the same file while the first is up exits non-zero with a message naming the running instance — it does not start a second server.
- [ ] (e) `--fresh` starts with no pre-existing annotations even if a session dir existed.
- [ ] (f) Ctrl-C releases the lock (a subsequent run starts without a "locked" complaint).

## When done

1. Verify acceptance list ticked.
2. `bun run typecheck`.
3. Set this file's `Status:` to `DONE`; set the root dashboard Phase 6 row to `DONE`.
4. Commit. Move to [`07-frontend-ui.md`](07-frontend-ui.md) — **note: that phase runs in your MAIN context, not a subagent.**
