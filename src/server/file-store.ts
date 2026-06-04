import type { FileKey, BlockNode } from "../shared/types";
import type { Session } from "./annotation-service";

// ---------------------------------------------------------------------------
// MdLink placeholder — populated in Phase 2 (link detection)
// ---------------------------------------------------------------------------

export interface MdLink {
  // Phase 2 will define the full shape; empty array is valid until then
  target: string;
}

// ---------------------------------------------------------------------------
// FileEntry — per-file cached state
// ---------------------------------------------------------------------------

export interface FileEntry {
  key: FileKey;
  filePath: string;      // absolute path
  source: string;
  fileHash: string;
  blocks: BlockNode[];
  fullHtml: string;
  links: MdLink[];        // from Phase 2; empty array is valid until Phase 2 lands
  fileName: string;       // basename for display
  annotationCount: number;
  session: Session;       // one lock/session per loaded file
}

// ---------------------------------------------------------------------------
// FileStore — in-memory registry of loaded files
// ---------------------------------------------------------------------------

export class FileStore {
  private entries = new Map<FileKey, FileEntry>();
  private entryKey: FileKey;
  private sessionRoot: string;

  constructor(sessionRoot: string, entryKey: FileKey) {
    this.sessionRoot = sessionRoot;
    this.entryKey = entryKey;
  }

  setEntry(key: FileKey): void {
    this.entryKey = key;
  }

  has(key: FileKey): boolean {
    return this.entries.has(key);
  }

  get(key: FileKey): FileEntry | undefined {
    return this.entries.get(key);
  }

  add(entry: FileEntry): void {
    this.entries.set(entry.key, entry);
  }

  list(): FileEntry[] {
    return Array.from(this.entries.values());
  }

  getEntryKey(): FileKey {
    return this.entryKey;
  }

  getSessionRoot(): string {
    return this.sessionRoot;
  }

  /** Release every file's annotation session lock. */
  async releaseAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      promises.push(entry.session.release());
    }
    await Promise.all(promises);
  }
}
