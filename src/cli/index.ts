#!/usr/bin/env bun
import { resolve } from "node:path";
import { access, constants, rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import qrcode from "qrcode-terminal";
import { startServer, SessionLockedError } from "../server/index";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const usage = `
Usage: mdr <path-to-markdown> [options]

Options:
  --port <n>         Port for the local server (default: auto-select)
  --tmp-dir <dir>    Root for annotation session storage (default: /tmp/markdown-review)
  --no-open          Don't auto-open the browser
  --lan              Expose the server on the local network and print a QR code
  --fresh            Discard existing session, start clean
  --auto-discover    Crawl the relative-.md link graph and add reachable files to session
  --clean            Delete all session data (manifests, markers, annotations) and exit
  -h, --help         Show this help message
`.trim();

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  filePath?: string;
  port?: number;
  tmpDir: string;
  noOpen: boolean;
  lan: boolean;
  fresh: boolean;
  autoDiscover: boolean;
  clean: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    tmpDir: "/tmp/markdown-review",
    noOpen: false,
    lan: false,
    fresh: false,
    autoDiscover: false,
    clean: false,
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

    if (arg === "--lan") {
      args.lan = true;
      i++;
      continue;
    }

    if (arg === "--fresh") {
      args.fresh = true;
      i++;
      continue;
    }

    if (arg === "--auto-discover") {
      args.autoDiscover = true;
      i++;
      continue;
    }

    if (arg === "--clean") {
      args.clean = true;
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
// LAN URL helpers
// ---------------------------------------------------------------------------

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

function getLanIpv4Address(): string | null {
  const candidates: string[] = [];

  for (const entries of Object.values(networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      candidates.push(entry.address);
    }
  }

  return candidates.find(isPrivateIpv4) ?? candidates[0] ?? null;
}

function renderTerminalQr(url: string): string {
  let output = "";
  qrcode.generate(url, { small: true }, (qr) => {
    output = qr;
  });
  return output;
}

function printLanAccess(port: number): void {
  const lanAddress = getLanIpv4Address();
  if (!lanAddress) {
    console.warn("LAN mode enabled, but no non-internal IPv4 address was found. Skipping LAN URL and QR code.");
    return;
  }

  const lanUrl = `http://${lanAddress}:${port}`;
  console.log(`LAN URL: ${lanUrl}`);
  console.log("Security: LAN mode is opt-in; anyone on your local network who can reach this host may access this review session.");
  console.log(renderTerminalQr(lanUrl));
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

  // --clean: delete all session data and exit
  if (args.clean) {
    try {
      await rm(args.tmpDir, { recursive: true, force: true });
      console.log(`Session data cleaned: ${args.tmpDir}`);
      process.exit(0);
    } catch (err: any) {
      console.error(`Error cleaning session data: ${err.message}`);
      process.exit(1);
    }
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
      autoDiscover: args.autoDiscover,
      lan: args.lan,
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
  if (args.lan) {
    printLanAccess(server.port);
  }

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
