#!/usr/bin/env bun
import { resolve } from "node:path";
import { access, constants } from "node:fs/promises";
import { startServer, SessionLockedError } from "../server/index";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const usage = `
Usage: mdr <path-to-markdown> [options]

Options:
  --port <n>       Port for the local server (default: auto-select)
  --tmp-dir <dir>  Root for annotation session storage (default: /tmp/markdown-review)
  --no-open        Don't auto-open the browser
  --fresh          Discard existing session, start clean
  -h, --help       Show this help message
`.trim();

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  filePath?: string;
  port?: number;
  tmpDir: string;
  noOpen: boolean;
  fresh: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    tmpDir: "/tmp/markdown-review",
    noOpen: false,
    fresh: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      i++;
      continue;
    }

    if (arg === "--port") {
      const val = argv[++i];
      if (val === undefined) {
        console.error("Error: --port requires a value");
        process.exit(1);
      }
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0 || n > 65535) {
        console.error(`Error: --port value must be a number between 0 and 65535, got "${val}"`);
        process.exit(1);
      }
      args.port = n;
      i++;
      continue;
    }

    if (arg === "--tmp-dir") {
      const val = argv[++i];
      if (val === undefined) {
        console.error("Error: --tmp-dir requires a value");
        process.exit(1);
      }
      args.tmpDir = val;
      i++;
      continue;
    }

    if (arg === "--no-open") {
      args.noOpen = true;
      i++;
      continue;
    }

    if (arg === "--fresh") {
      args.fresh = true;
      i++;
      continue;
    }

    // Positional arg (first non-flag)
    if (!arg.startsWith("-")) {
      if (args.filePath === undefined) {
        args.filePath = arg;
      }
      i++;
      continue;
    }

    // Unknown flag
    console.error(`Error: unknown option "${arg}"`);
    process.exit(1);
  }

  return args;
}

// ---------------------------------------------------------------------------
// Browser open
// ---------------------------------------------------------------------------

function getOpenCommand(): string {
  if (process.platform === "win32") return "start";
  if (process.platform === "darwin") return "open";
  return "xdg-open";
}

async function openBrowser(url: string): Promise<void> {
  // Spawn the opener directly (not via sh) — sh would look for a script file
  // named "open"/"xdg-open" rather than the command itself.
  // On Windows, use `start "" "url"` so the empty string is the window title
  // and the URL is treated as the target (fixes URLs being parsed as titles).
  const args = process.platform === "win32"
    ? ["/c", `start "" "${url}"`]
    : [getOpenCommand(), url];
  const cmd = process.platform === "win32" ? "cmd" : getOpenCommand();

  try {
    const proc = process.platform === "win32"
      ? Bun.spawn(["cmd", ...args], {
          stdio: ["inherit", "inherit", "inherit"],
        })
      : Bun.spawn([cmd, url], {
          stdio: ["inherit", "inherit", "inherit"],
        });
    await proc.exited;
  } catch {
    // Non-fatal — URL is already printed
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Help
  if (args.help) {
    console.log(usage);
    process.exit(0);
  }

  // Require positional path
  if (!args.filePath) {
    console.error("Error: missing required argument <path-to-markdown>");
    console.error("");
    console.error(usage);
    process.exit(1);
  }

  // Resolve to absolute path
  const filePath = resolve(args.filePath);

  // Validate file exists and is readable
  try {
    await access(filePath, constants.R_OK);
  } catch {
    console.error(`Error: file not found or not readable: ${filePath}`);
    process.exit(1);
  }

  // Start the server
  let server: Awaited<ReturnType<typeof startServer>> | null = null;

  try {
    server = await startServer({
      filePath,
      port: args.port,
      tmpDir: args.tmpDir,
      fresh: args.fresh,
    });
  } catch (err) {
    if (err instanceof SessionLockedError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  // Print URL (always)
  console.log(`markdown-reviewer running at ${server.url}`);

  // Open browser unless --no-open
  if (!args.noOpen) {
    openBrowser(server.url);
  }

  // Signal handling — release lock on Ctrl-C / SIGTERM
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    if (server) {
      await server.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for server to stop (self-shutdown after POST /api/done, or signal handler).
  // The signal handler calls stop() which resolves the stopped promise,
  // so this catches both cases.
  await server.stopped;
  process.exit(0);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
