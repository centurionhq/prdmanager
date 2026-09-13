import { z } from 'zod';
import { DOC_KINDS, docId, type ParsedDoc } from '../domain/schema.js';
import type { Engine } from '../engine.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';
import { scanDocuments, type ScanResult } from '../parser/scan.js';
import { sha256 } from '../util/hash.js';
import { nextId, renderDocument, slugify, todayIso } from '../util/ids.js';
import { safeReadFile } from '../util/safe-fs.js';
import { assertDraftableKind, assertValidFieldKeys } from './forbidden-fields.js';
import { DraftStore, type DraftRecord } from './draft-store.js';
import { DraftValidationError, type CommitResult, type DraftContent, type DraftView } from './types.js';
import { validateDraft, type ValidationOutcome } from './validate.js';

const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.record(z.string(), z.string())]);

// Accepts every DocKind (including WO) so a WO draft fails with `assertDraftableKind`'s clear message below,
// rather than a generic zod enum-mismatch error.
const draftContentSchema = z.object({
  kind: z.enum(DOC_KINDS as unknown as [string, ...string[]]),
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(200_000),
  fields: z.record(z.string(), fieldValueSchema).optional(),
});

const draftInputSchema = draftContentSchema.extend({
  draftId: z.string().min(1).optional(),
  updateId: docId.optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export type DraftInput = z.input<typeof draftInputSchema>;

export interface AuthoringServiceDeps {
  engine: Engine;
  drafts: DraftStore;
  clock?: () => Date;
}

/**
 * Conversational authoring surface (SDD-002 "Autoría conversacional"): holds in-memory draft sessions,
 * validates them against the live repository state with no Neo4j I/O, and commits them through the engine's
 * journaled atomic transaction so a failure at any point (including the final graph snapshot) leaves no trace.
 */
export class AuthoringService {
  private readonly engine: Engine;
  private readonly drafts: DraftStore;
  private readonly clock: () => Date;

  constructor(deps: AuthoringServiceDeps) {
    this.engine = deps.engine;
    this.drafts = deps.drafts;
    this.clock = deps.clock ?? (() => new Date());
  }

  async draft(input: DraftInput): Promise<DraftView> {
    const parsed = draftInputSchema.parse(input);
    assertDraftableKind(parsed.kind);
    assertValidFieldKeys(parsed.fields);
    const content: DraftContent = { kind: parsed.kind, title: parsed.title, body: parsed.body, fields: parsed.fields as Record<string, FieldValue> | undefined };

    let record: DraftRecord;
    if (parsed.draftId) {
      record = this.drafts.replace(parsed.draftId, content, parsed.expectedRevision);
    } else if (parsed.updateId) {
      record = await this.openUpdateDraft(parsed.updateId, content);
    } else {
      record = this.drafts.create(content);
    }
    return this.buildView(record.draftId);
  }

  async validate(draftId: string): Promise<DraftView> {
    return this.buildView(draftId);
  }

  discard(draftId: string): boolean {
    this.drafts.sweep();
    return this.drafts.remove(draftId);
  }

  list(): Omit<DraftView, 'rendered' | 'validation'>[] {
    return this.drafts.list().map((record) => this.viewMetadata(record));
  }

  async commit(draftId: string, expectedRevision: number): Promise<CommitResult> {
    this.drafts.sweep();
    const tombstoned = this.drafts.getTombstone(draftId, expectedRevision);
    if (tombstoned) return tombstoned;

    const record = this.drafts.get(draftId);
    if (!record) throw new Error(`draft ${draftId} not found`);
    if (record.revision !== expectedRevision) throw new Error(`draft ${draftId} revision mismatch: expected ${expectedRevision}, current is ${record.revision}`);

    const result = await this.engine.transaction(
      async (ops) => {
        this.drafts.sweep();
        const replay = this.drafts.getTombstone(draftId, expectedRevision);
        if (replay) return replay;
        const current = this.drafts.get(draftId);
        if (!current) throw new Error(`draft ${draftId} not found`);
        if (current.revision !== expectedRevision) throw new Error(`draft ${draftId} revision mismatch: expected ${expectedRevision}, current is ${current.revision}`);

        const scan = await ops.scan();
        const currentRawHash = await this.currentRawHash(ops.config.root, current, scan);
        const outcome = validateDraft(current, { scan, grandfathered: ops.config.lifecycle.grandfathered, currentRawHash });
        if (outcome.issues.some((i) => i.severity === 'error')) throw new DraftValidationError(draftId, outcome.issues);

        const id = current.mode === 'create' ? nextId(current.kind, scan.ids) : current.targetId;
        const fields: Record<string, FieldValue> = { ...outcome.cleanFields, id, type: current.kind, title: current.content.title };
        if (current.mode === 'create' && fields.created_at === undefined) fields.created_at = todayIso(this.clock());

        const doc =
          current.mode === 'create'
            ? await ops.createDocument(`${ops.config.folders[current.kind]}/${id}-${slugify(current.content.title)}.md`, renderDocument(fields, current.content.body))
            : await ops.replaceDocument(id, renderDocument(fields, current.content.body));

        const report = await ops.refresh();
        return { draftId, id, path: doc.node.sourcePath, issues: report.issues, hasBlockingIssues: report.hasBlockingIssues } satisfies CommitResult;
      },
      { atomic: true },
    );

    // Only reached once the transaction has fully succeeded (its journal is already deleted): tombstoning any
    // earlier, inside the still-running transaction, would record success before a later failure (e.g. the
    // journal's own delete) triggers a rollback that contradicts it (WO-023 finding 8).
    this.drafts.tombstone(draftId, expectedRevision, result);
    this.drafts.remove(draftId);
    return result;
  }

  private async openUpdateDraft(updateId: string, content: DraftContent): Promise<DraftRecord> {
    const scan = await scanDocuments(this.engine.config.root, this.engine.config.ignore);
    const doc = scan.docs.find((d) => d.node.id === updateId);
    if (!doc) throw new Error(`document ${updateId} not found`);
    assertDraftableKind(doc.node.kind);
    if (doc.node.kind !== content.kind) throw new Error(`${updateId} is a ${doc.node.kind}, not a ${content.kind}`);
    const raw = await safeReadFile(this.engine.config.root, doc.node.sourcePath);
    if (raw === null) throw new Error(`document ${updateId} no longer exists`);
    return this.drafts.openUpdate(updateId, doc, content, sha256(raw));
  }

  private async buildView(draftId: string): Promise<DraftView> {
    const record = this.drafts.touch(draftId);
    if (!record) throw new Error(`draft ${draftId} not found`);
    const scan = await scanDocuments(this.engine.config.root, this.engine.config.ignore);
    const outcome = await this.runValidation(record, scan);
    return {
      ...this.viewMetadata(record),
      rendered: outcome.rendered,
      validation: { ok: !outcome.issues.some((i) => i.severity === 'error'), issues: outcome.issues },
    };
  }

  private async runValidation(record: DraftRecord, scan: ScanResult): Promise<ValidationOutcome> {
    const currentRawHash = await this.currentRawHash(this.engine.config.root, record, scan);
    return validateDraft(record, { scan, grandfathered: this.engine.config.lifecycle.grandfathered, currentRawHash });
  }

  /** sha256 of the target document's raw file bytes right now; undefined for a create draft or an unreadable/missing target (WO-023 finding 5). */
  private async currentRawHash(root: string, record: DraftRecord, scan: ScanResult): Promise<string | undefined> {
    if (record.mode !== 'update') return undefined;
    const current = scan.docs.find((d) => d.node.id === record.targetId) as ParsedDoc | undefined;
    if (!current) return undefined;
    const raw = await safeReadFile(root, current.node.sourcePath).catch(() => null);
    return raw === null ? undefined : sha256(raw);
  }

  private viewMetadata(record: DraftRecord): Omit<DraftView, 'rendered' | 'validation'> {
    return {
      draftId: record.draftId,
      projectId: this.engine.config.project.id,
      mode: record.mode,
      targetId: record.mode === 'create' ? `${record.kind}-?` : record.targetId,
      kind: record.kind,
      revision: record.revision,
      expiresAt: new Date(record.expiresAt).toISOString(),
      targetPath: record.basePath ?? null,
    };
  }
}
