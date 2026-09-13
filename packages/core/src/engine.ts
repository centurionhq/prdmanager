import type { PrdmConfig } from './config.js';
import type { ParsedDoc, WorkOrderStatus } from './domain/schema.js';
import type { GraphStore } from './graph/types.js';
import { renameFrontmatterKey, setFrontmatterFields, type FieldValue } from './parser/frontmatter-edit.js';
import { parseDocument } from './parser/frontmatter.js';
import { scanDocuments, type ScanError, type ScanResult } from './parser/scan.js';
import { loadBaseline, saveBaseline } from './sync/baseline.js';
import { resolveGoverned, type CodeRefState } from './sync/code-refs.js';
import { dirtyPaths, readCommits } from './sync/git.js';
import { acknowledge, detectDrift, type DriftInput, type DriftIssue, type GovernedState, type WorkOrderUpdate } from './sync/monitor.js';
import { resolveInside } from './util/paths.js';
import { withRepoLock } from './util/lock.js';
import { safeReadFile, safeWriteFile } from './util/safe-fs.js';

export interface RefreshReport {
  documents: number;
  errors: ScanError[];
  issues: DriftIssue[];
  governed: (GovernedState & { hash: string | null })[];
  workOrderUpdates: WorkOrderUpdate[];
  baselineWritten: boolean;
  hasBlockingIssues: boolean;
}

/** Unlocked operations available inside Engine.transaction(); never call Engine's public methods from within one. */
export interface EngineOps {
  readonly config: PrdmConfig;
  readonly store: GraphStore;
  scan(): Promise<ScanResult>;
  createDocument(relPath: string, content: string): Promise<ParsedDoc>;
  updateDocument(id: string, fields: Record<string, FieldValue>): Promise<ParsedDoc>;
  /** Renames a top-level frontmatter key in place (e.g. legacy `governs` -> `impacts_paths`), keeping its value's formatting. */
  renameFrontmatterField(id: string, oldKey: string, newKey: string): Promise<ParsedDoc>;
  refresh(): Promise<RefreshReport>;
}

export class Engine {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly ops: EngineOps;

  constructor(
    readonly config: PrdmConfig,
    readonly store: GraphStore,
  ) {
    this.ops = {
      config,
      store,
      scan: () => scanDocuments(config.root, config.ignore),
      createDocument: (relPath, content) => this.createDocument(relPath, content),
      updateDocument: (id, fields) => this.updateDocument(id, fields),
      renameFrontmatterField: (id, oldKey, newKey) => this.renameFrontmatterField(id, oldKey, newKey),
      refresh: () => this.doRefresh(),
    };
  }

  /** Serializes mutations in-process (queue) and across processes (lockfile) so file writes and graph snapshots never interleave. */
  transaction<T>(fn: (ops: EngineOps) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => withRepoLock(this.config.root, () => fn(this.ops)));
    this.queue = run.catch(() => undefined);
    return run;
  }

  refresh(): Promise<RefreshReport> {
    return this.transaction((ops) => ops.refresh());
  }

  acknowledge(target: string): Promise<RefreshReport> {
    return this.transaction(async () => {
      const { scan, input } = await this.collect();
      if (scan.errors.length > 0) throw new Error(`fix ${scan.errors.length} invalid document(s) before acknowledging (run prdm lint)`);
      const result = acknowledge(input, target);
      for (const update of result.workOrderHashUpdates) {
        await this.writeFields(update.sourcePath, { blueprint_hashes: update.blueprintHashes });
      }
      await saveBaseline(this.config.root, result.baseline);
      return this.doRefresh();
    });
  }

  private async collect(): Promise<{ scan: ScanResult; input: DriftInput }> {
    const { root, ignore, gitMaxCommits } = this.config;
    const scan = await scanDocuments(root, ignore);
    const governed = new Map<string, CodeRefState[]>();
    const governWarnings: DriftInput['governWarnings'] = [];
    for (const doc of scan.docs.filter((d) => d.node.label === 'Blueprint')) {
      const { refs, warnings } = await resolveGoverned(root, doc.impactsPaths, ignore);
      governed.set(doc.node.id, refs);
      governWarnings.push(...warnings.map((message) => ({ blueprintId: doc.node.id, message })));
    }
    const [commits, dirty, baseline] = await Promise.all([readCommits(root, gitMaxCommits), dirtyPaths(root), loadBaseline(root)]);
    return { scan, input: { docs: scan.docs, governed, governWarnings, baseline, commits, dirty } };
  }

  private async doRefresh(): Promise<RefreshReport> {
    const { scan, input } = await this.collect();
    const drift = detectDrift(input);

    const { applied, failures } = await this.applyStatusUpdates(drift.workOrderUpdates);
    const statusById = new Map(applied.map((u) => [u.id, u.to]));
    const docs = scan.docs.map((d) => withStatus(d, statusById.get(d.node.id)));
    const issues = [...drift.issues, ...failures];

    const hashByKey = new Map([...input.governed].flatMap(([bp, refs]) => refs.map((r) => [`${bp}|${r.key}`, r.hash] as const)));
    const governed = drift.governed.map((g) => ({ ...g, hash: hashByKey.get(`${g.blueprintId}|${g.key}`) ?? null }));

    // A document that temporarily fails to parse would otherwise be pruned from the baseline and come back as "new" (drift silently accepted).
    const baselineWritten = scan.errors.length === 0 ? await saveBaseline(this.config.root, drift.baseline) : false;
    await this.store.writeSnapshot({ docs, governed, reviewNeeded: drift.reviewNeeded, commits: input.commits });

    return {
      documents: docs.length,
      errors: scan.errors,
      issues,
      governed,
      workOrderUpdates: applied,
      baselineWritten,
      hasBlockingIssues: scan.errors.length > 0 || issues.some((i) => i.severity === 'error'),
    };
  }

  private async applyStatusUpdates(updates: WorkOrderUpdate[]): Promise<{ applied: WorkOrderUpdate[]; failures: DriftIssue[] }> {
    const results = await Promise.all(
      updates.map(async (update) => {
        try {
          await this.writeFields(update.sourcePath, { status: update.to });
          return { update, failure: null };
        } catch (err) {
          const failure: DriftIssue = { kind: 'status_write_failed', severity: 'error', nodeId: update.id, message: `could not set ${update.id} to ${update.to}: ${(err as Error).message}` };
          return { update: null, failure };
        }
      }),
    );
    return {
      applied: results.flatMap((r) => (r.update ? [r.update] : [])),
      failures: results.flatMap((r) => (r.failure ? [r.failure] : [])),
    };
  }

  private async createDocument(relPath: string, content: string): Promise<ParsedDoc> {
    const { rel } = resolveInside(this.config.root, relPath);
    const docsPrefix = `${resolveInside(this.config.root, this.config.docsDir).rel}/`;
    if (!rel.startsWith(docsPrefix) || !rel.endsWith('.md')) throw new Error(`documents must be created as .md files under ${docsPrefix}`);
    const parsed = parseDocument(content, rel);
    if (!parsed) throw new Error('document content has no graph frontmatter (id/type)');
    if (!parsed.ok) throw new Error(`invalid document: ${parsed.error}`);
    const existing = await scanDocuments(this.config.root, this.config.ignore);
    if (existing.ids.includes(parsed.doc.node.id)) throw new Error(`document ${parsed.doc.node.id} already exists`);
    await safeWriteFile(this.config.root, rel, content, { exclusive: true });
    return parsed.doc;
  }

  private async updateDocument(id: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    const sourcePath = await this.sourcePathOf(id);
    return this.writeFields(sourcePath, fields);
  }

  private async renameFrontmatterField(id: string, oldKey: string, newKey: string): Promise<ParsedDoc> {
    const sourcePath = await this.sourcePathOf(id);
    return this.applyEdit(sourcePath, (content) => renameFrontmatterKey(content, oldKey, newKey));
  }

  private async sourcePathOf(id: string): Promise<string> {
    const { docs } = await scanDocuments(this.config.root, this.config.ignore);
    const doc = docs.find((d) => d.node.id === id);
    if (!doc) throw new Error(`document ${id} not found`);
    return doc.node.sourcePath;
  }

  /** Rewrites frontmatter fields and rolls back if the result no longer validates. */
  private writeFields(sourcePath: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    return this.applyEdit(sourcePath, (content) => setFrontmatterFields(content, fields));
  }

  /** Applies `edit` to a document's raw content and rolls back if the result no longer validates. */
  private async applyEdit(sourcePath: string, edit: (content: string) => string): Promise<ParsedDoc> {
    const { rel } = resolveInside(this.config.root, sourcePath);
    const original = await safeReadFile(this.config.root, rel);
    if (original === null) throw new Error(`document ${rel} no longer exists`);
    const next = edit(original);
    const parsed = parseDocument(next, rel);
    if (!parsed?.ok) throw new Error(`update would invalidate ${rel}: ${parsed ? parsed.error : 'frontmatter lost'}`);
    await safeWriteFile(this.config.root, rel, next);
    return parsed.doc;
  }
}

function withStatus(doc: ParsedDoc, status: WorkOrderStatus | undefined): ParsedDoc {
  if (!status) return doc;
  return {
    ...doc,
    node: { ...doc.node, status },
    frontmatter: { ...doc.frontmatter, status } as ParsedDoc['frontmatter'],
  };
}
