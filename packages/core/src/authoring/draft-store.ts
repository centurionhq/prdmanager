import { randomBytes } from 'node:crypto';
import type { AuthoringSettings } from '../project/types.js';
import type { ParsedDoc } from '../domain/schema.js';
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

const generateDraftId = (): string => `drf_${randomBytes(16).toString('base64url')}`;

/** In-memory, per-process store of open drafts: sliding TTL, a cap on concurrent drafts and on each draft's size. */
export class DraftStore {
  private readonly records = new Map<string, DraftRecord>();
  private readonly tombstones = new Map<string, { result: CommitResult; expiresAt: number }>();

  constructor(
    private readonly limits: AuthoringSettings,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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

  /** Drops every draft and tombstone whose sliding TTL has elapsed. Idempotent; call before any read or write. */
  sweep(): void {
    const now = this.now();
    for (const [id, record] of this.records) if (record.expiresAt <= now) this.records.delete(id);
    for (const [id, tombstone] of this.tombstones) if (tombstone.expiresAt <= now) this.tombstones.delete(id);
  }

  create(content: DraftContent): DraftRecord {
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
    this.records.set(record.draftId, record);
    return record;
  }

  openUpdate(targetId: string, doc: ParsedDoc, content: DraftContent): DraftRecord {
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
      baseHash: doc.node.contentHash,
      baseFrontmatter: doc.frontmatter as unknown as Record<string, unknown>,
    };
    this.records.set(record.draftId, record);
    return record;
  }

  replace(draftId: string, content: DraftContent, expectedRevision?: number): DraftRecord {
    this.sweep();
    const record = this.records.get(draftId);
    if (!record) throw new Error(`draft ${draftId} not found`);
    if (content.kind !== record.kind) throw new Error(`draft ${draftId} was opened as ${record.kind} and cannot change kind`);
    if (expectedRevision !== undefined && record.revision !== expectedRevision) {
      throw new Error(`draft ${draftId} revision mismatch: expected ${expectedRevision}, current is ${record.revision}`);
    }
    this.assertSize(content);
    const next: DraftRecord = { ...record, content, revision: record.revision + 1, expiresAt: this.now() + this.ttlMs() };
    this.records.set(draftId, next);
    return next;
  }

  get(draftId: string): DraftRecord | undefined {
    this.sweep();
    return this.records.get(draftId);
  }

  /** Reads a draft and slides its TTL forward, as if it had just been accessed. */
  touch(draftId: string): DraftRecord | undefined {
    this.sweep();
    const record = this.records.get(draftId);
    if (!record) return undefined;
    record.expiresAt = this.now() + this.ttlMs();
    return record;
  }

  remove(draftId: string): boolean {
    return this.records.delete(draftId);
  }

  list(): DraftRecord[] {
    this.sweep();
    return [...this.records.values()];
  }

  /** Remembers a commit's result for the draft's remaining TTL so a retried commit is idempotent instead of erroring on "not found". */
  tombstone(draftId: string, result: CommitResult): void {
    this.tombstones.set(draftId, { result, expiresAt: this.now() + this.ttlMs() });
  }

  getTombstone(draftId: string): CommitResult | undefined {
    this.sweep();
    return this.tombstones.get(draftId)?.result;
  }
}
