import { safeReadFile, safeReplaceAtomic } from '../util/safe-fs.js';

interface SymbolCacheEntry {
  fileHash: string;
  blockHash: string;
}

const CACHE_PATH = '.prdm/symbol-cache.json';

/**
 * Content-hash-keyed cache of extracted symbol blocks (SDD-004). The post-commit hook re-runs `prdm sync`
 * after every commit, and each run would otherwise re-parse every governed symbol whether its file changed or
 * not; caching by the whole file's current sha256 skips the extractor entirely when nothing did. Purely derived
 * from the working tree and safe to delete — a missing or corrupt cache file is treated as empty, never as an
 * error, and a symbol that isn't found is never cached (so a transient miss doesn't stick).
 */
export class SymbolCache {
  private dirty = false;

  private constructor(private readonly entries: Map<string, SymbolCacheEntry>) {}

  static async load(root: string): Promise<SymbolCache> {
    const raw = await safeReadFile(root, CACHE_PATH).catch(() => null);
    if (raw === null) return new SymbolCache(new Map());
    try {
      const parsed = JSON.parse(raw) as Record<string, SymbolCacheEntry>;
      return new SymbolCache(new Map(Object.entries(parsed)));
    } catch {
      return new SymbolCache(new Map());
    }
  }

  /** `fileHash` is the sha256 of the whole file's raw content right now. Returns `undefined` on a miss (no entry, or the file changed since it was cached). */
  get(key: string, fileHash: string): string | undefined {
    const entry = this.entries.get(key);
    return entry?.fileHash === fileHash ? entry.blockHash : undefined;
  }

  set(key: string, fileHash: string, blockHash: string): void {
    this.entries.set(key, { fileHash, blockHash });
    this.dirty = true;
  }

  /** No-op when nothing changed, so a purely read-only refresh (e.g. `closureReadiness`) never touches disk. */
  async saveIfDirty(root: string): Promise<void> {
    if (!this.dirty) return;
    const sorted = Object.fromEntries([...this.entries].sort(([a], [b]) => a.localeCompare(b)));
    await safeReplaceAtomic(root, CACHE_PATH, JSON.stringify(sorted));
    this.dirty = false;
  }
}
