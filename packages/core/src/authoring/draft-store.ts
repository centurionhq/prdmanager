import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { AuthoringSettings } from '../project/types.js';
import type { ParsedDoc } from '../domain/schema.js';
import { safeReadFile, safeReplaceAtomic, safeUnlink } from '../util/safe-fs.js';
import type { CommitResult, DraftContent, DraftKind, DraftMode } from './types.js';

export interface DraftRecord {
  draftId: string;
  mode: DraftMode;
  /** `${kind}-?` for a create draft; the real, already-committed document id for an update draft. */
  targetId: string;
  kind: DraftKind;
  content: DraftContent;
  revision: number;
  createdAt: number;
  expiresAt: number;
  /** Update-draft only: the file path, content hash and full frontmatter of the document at the moment the draft was opened. */
  basePath?: string;
  baseHash?: string;
  baseFrontmatter?: Record<string, unknown>;
}

interface TombstoneEntry {
  result: CommitResult;
  expiresAt: number;
  expectedRevision: number;
}

const generateDraftId = (): string => `drf_${randomBytes(16).toString('base64url')}`;

/** SDD-003 "Un archivo por borrador": one JSON file per open draft, replaced by a `.tombstone.json` sibling once it commits. */
const DRAFTS_DIR = '.prdm/drafts';
const draftPath = (draftId: string): string => `${DRAFTS_DIR}/${draftId}.json`;
const tombstonePath = (draftId: string): string => `${DRAFTS_DIR}/${draftId}.tombstone.json`;

/**
 * Durable, per-process store of open drafts (SDD-003 / FR-001): sliding TTL, a cap on concurrent drafts and on
 * each draft's size. Every mutation that must survive a crash (`create`, `openUpdate`, `replace`, `remove`,
 * `tombstone`) persists to `.prdm/drafts/` via the same atomic-write primitives as everything else the engine
 * writes, and returns only once that write has landed. `touch()` slides the in-memory TTL only: losing a few
 * minutes of that slide to a crash is an accepted, documented trade-off (SDD-003 "DraftStore pasa a ser durable").
 */
export class DraftStore {
  private readonly records = new Map<string, DraftRecord>();
  private readonly tombstones = new Map<string, TombstoneEntry>();

  constructor(
    private readonly limits: AuthoringSettings,
    private readonly root: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Recovers open drafts and tombstones left by a previous process (FR-001 "Recuperación de sesión"); never throws on a corrupt file. */
  static async open(limits: AuthoringSettings, root: string, clock: () => Date = () => new Date()): Promise<{ store: DraftStore; warnings: string[] }> {
    const store = new DraftStore(limits, root, clock);
    const warnings = await store.load();
    return { store, warnings };
  }

  private now(): number {
    return this.clock().getTime();
  }

  private ttlMs(): number {
    return this.limits.draftTtlMinutes * 60_000;
  }

  private assertSize(content: DraftContent): void {
    const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
    if (bytes > this.limits.maxDraftBytes) throw new Error(`draft content exceeds the ${this.limits.maxDraftBytes}-byte limit`);
  }

  private assertRoom(): void {
    if (this.records.size >= this.limits.maxDrafts) throw new Error(`draft limit reached (${this.limits.maxDrafts}); discard a draft before opening another`);
  }

  private async persistDraft(record: DraftRecord): Promise<void> {
    await safeReplaceAtomic(this.root, draftPath(record.draftId), JSON.stringify(record));
  }

  /** Loads every `.prdm/drafts/*.json` left on disk; corrupt or already-expired entries are dropped (and their file removed) with a warning, not thrown. */
  private async load(): Promise<string[]> {
    const warnings: string[] = [];
    let names: string[];
    try {
      names = await readdir(`${this.root}/${DRAFTS_DIR}`);
    } catch {
      return warnings;
    }
    const now = this.now();
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const rel = `${DRAFTS_DIR}/${name}`;
      const raw = await safeReadFile(this.root, rel).catch((err: unknown) => {
        warnings.push(`could not read ${name}: ${(err as Error).message}`);
        return null;
      });
      if (raw === null) continue;
      try {
        if (name.endsWith('.tombstone.json')) {
          const entry = JSON.parse(raw) as TombstoneEntry & { draftId: string };
          if (entry.expiresAt > now) this.tombstones.set(entry.draftId, entry);
          else await safeUnlink(this.root, rel).catch(() => undefined);
        } else {
          const record = JSON.parse(raw) as DraftRecord;
          if (record.expiresAt > now) this.records.set(record.draftId, record);
          else await safeUnlink(this.root, rel).catch(() => undefined);
        }
      } catch (err) {
        warnings.push(`skipping corrupt draft file ${name}: ${(err as Error).message}`);
      }
    }
    return warnings;
  }

  /** Drops every in-memory draft and tombstone whose sliding TTL has elapsed. Idempotent; call before any read. On-disk cleanup for the files that go with them is best-effort (a stray expired file is swept again on the next `open()`). */
  sweep(): void {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(id);
        void safeUnlink(this.root, draftPath(id)).catch(() => undefined);
      }
    }
    for (const [id, tombstone] of this.tombstones) {
      if (tombstone.expiresAt <= now) {
        this.tombstones.delete(id);
        void safeUnlink(this.root, tombstonePath(id)).catch(() => undefined);
      }
    }
  }

  async create(content: DraftContent): Promise<DraftRecord> {
    this.sweep();
    this.assertRoom();
    this.assertSize(content);
    const now = this.now();
    const record: DraftRecord = {
      draftId: generateDraftId(),
      mode: 'create',
      targetId: `${content.kind}-?`,
      kind: content.kind,
      content,
      revision: 0,
      createdAt: now,
      expiresAt: now + this.ttlMs(),
    };
    await this.persistDraft(record);
    this.records.set(record.draftId, record);
    return record;
  }

  /** `baseHash` must be the sha256 of the target document's raw file bytes at this exact moment (see WO-023 finding 5), not its parsed `contentHash` (which deliberately ignores fields like `status`). */
  async openUpdate(targetId: string, doc: ParsedDoc, content: DraftContent, baseHash: string): Promise<DraftRecord> {
    this.sweep();
    this.assertRoom();
    this.assertSize(content);
    const now = this.now();
    const record: DraftRecord = {
      draftId: generateDraftId(),
      mode: 'update',
      targetId,
      kind: content.kind,
      content,
      revision: 0,
      createdAt: now,
      expiresAt: now + this.ttlMs(),
      basePath: doc.node.sourcePath,
      baseHash,
      baseFrontmatter: doc.frontmatter as unknown as Record<string, unknown>,
    };
    await this.persistDraft(record);
    this.records.set(record.draftId, record);
    return record;
  }

  async replace(draftId: string, content: DraftContent, expectedRevision?: number): Promise<DraftRecord> {
    this.sweep();
    const record = this.records.get(draftId);
    if (!record) throw new Error(`draft ${draftId} not found`);
    if (content.kind !== record.kind) throw new Error(`draft ${draftId} was opened as ${record.kind} and cannot change kind`);
    if (expectedRevision !== undefined && record.revision !== expectedRevision) {
      throw new Error(`draft ${draftId} revision mismatch: expected ${expectedRevision}, current is ${record.revision}`);
    }
    this.assertSize(content);
    const next: DraftRecord = { ...record, content, revision: record.revision + 1, expiresAt: this.now() + this.ttlMs() };
    await this.persistDraft(next);
    this.records.set(draftId, next);
    return next;
  }

  get(draftId: string): DraftRecord | undefined {
    this.sweep();
    return this.records.get(draftId);
  }

  /** Reads a draft and slides its TTL forward, as if it had just been accessed. In-memory only (see class doc). */
  touch(draftId: string): DraftRecord | undefined {
    this.sweep();
    const record = this.records.get(draftId);
    if (!record) return undefined;
    record.expiresAt = this.now() + this.ttlMs();
    return record;
  }

  /** Drops a draft; deletes its on-disk file, unless it was just tombstoned (that file is the tombstone now, and stays). */
  async remove(draftId: string): Promise<boolean> {
    const existed = this.records.delete(draftId);
    if (existed && !this.tombstones.has(draftId)) await safeUnlink(this.root, draftPath(draftId)).catch(() => undefined);
    return existed;
  }

  list(): DraftRecord[] {
    this.sweep();
    return [...this.records.values()];
  }

  /** Remembers a commit's result for the draft's remaining TTL so a retried commit (same draftId + expectedRevision) is idempotent instead of erroring on "not found". Replaces the draft's file with a tombstone file of the same lifetime. */
  async tombstone(draftId: string, expectedRevision: number, result: CommitResult): Promise<void> {
    const expiresAt = this.now() + this.ttlMs();
    await safeReplaceAtomic(this.root, tombstonePath(draftId), JSON.stringify({ draftId, result, expiresAt, expectedRevision }));
    await safeUnlink(this.root, draftPath(draftId)).catch(() => undefined);
    this.tombstones.set(draftId, { result, expiresAt, expectedRevision });
  }

  /**
   * Returns the tombstoned result only when `expectedRevision` matches the one the commit actually succeeded
   * with; a mismatch means the caller thinks it is replaying a commit it never made, so it must get an error,
   * never a silently-returned result for the wrong revision (WO-023 finding 8).
   */
  getTombstone(draftId: string, expectedRevision: number): CommitResult | undefined {
    this.sweep();
    const entry = this.tombstones.get(draftId);
    if (!entry) return undefined;
    if (entry.expectedRevision !== expectedRevision) {
      throw new Error(`draft ${draftId} revision mismatch: it was already committed at revision ${entry.expectedRevision}, not ${expectedRevision}`);
    }
    return entry.result;
  }
}
