import type { PrdmConfig } from './config.js';
import type { ParsedDoc, WorkOrderStatus } from './domain/schema.js';
import type { GraphStore } from './graph/types.js';
import { setFrontmatterFields, type FieldValue } from './parser/frontmatter-edit.js';
import { parseDocument } from './parser/frontmatter.js';
import { scanDocuments, type ScanError, type ScanResult } from './parser/scan.js';
import { loadBaseline, saveBaseline } from './sync/baseline.js';
import { resolveGoverned, type CodeRefState } from './sync/code-refs.js';
import { dirtyPaths, readCommits } from './sync/git.js';
import { acknowledge, detectDrift, type DriftInput, type DriftIssue, type GovernedState, type WorkOrderUpdate } from './sync/monitor.js';
import { resolveInside } from './util/paths.js';
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
      refresh: () => this.doRefresh(),
    };
  }

  /** Serializes mutating operations so concurrent MCP calls cannot interleave file writes and graph snapshots. */
  transaction<T>(fn: (ops: EngineOps) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => fn(this.ops));
    this.queue = run.catch(() => undefined);
    return run;
  }

  refresh(): Promise<RefreshReport> {
    return this.transaction((ops) => ops.refresh());
  }

  acknowledge(target: string): Promise<RefreshReport> {
    return this.transaction(async () => {
      const { input } = await this.collect();
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
      const { refs, warnings } = await resolveGoverned(root, doc.governs, ignore);
      governed.set(doc.node.id, refs);
      governWarnings.push(...warnings.map((message) => ({ blueprintId: doc.node.id, message })));
    }
    const [commits, dirty, baseline] = await Promise.all([readCommits(root, gitMaxCommits), dirtyPaths(root), loadBaseline(root)]);
    return { scan, input: { docs: scan.docs, governed, governWarnings, baseline, commits, dirty } };
  }

  private async doRefresh(): Promise<RefreshReport> {
    const { scan, input } = await this.collect();
    const drift = detectDrift(input);

    for (const update of drift.workOrderUpdates) await this.writeFields(update.sourcePath, { status: update.to });
    const statusById = new Map(drift.workOrderUpdates.map((u) => [u.id, u.to]));
    const docs = scan.docs.map((d) => withStatus(d, statusById.get(d.node.id)));

    const hashByKey = new Map([...input.governed].flatMap(([bp, refs]) => refs.map((r) => [`${bp}|${r.key}`, r.hash] as const)));
    const governed = drift.governed.map((g) => ({ ...g, hash: hashByKey.get(`${g.blueprintId}|${g.key}`) ?? null }));

    const baselineWritten = await saveBaseline(this.config.root, drift.baseline);
    await this.store.writeSnapshot({ docs, governed, reviewNeeded: drift.reviewNeeded, commits: input.commits });

    return {
      documents: docs.length,
      errors: scan.errors,
      issues: drift.issues,
      governed,
      workOrderUpdates: drift.workOrderUpdates,
      baselineWritten,
      hasBlockingIssues: scan.errors.length > 0 || drift.issues.some((i) => i.severity === 'error'),
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
    if (existing.docs.some((d) => d.node.id === parsed.doc.node.id)) throw new Error(`document ${parsed.doc.node.id} already exists`);
    await safeWriteFile(this.config.root, rel, content, { exclusive: true });
    return parsed.doc;
  }

  private async updateDocument(id: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    const { docs } = await scanDocuments(this.config.root, this.config.ignore);
    const doc = docs.find((d) => d.node.id === id);
    if (!doc) throw new Error(`document ${id} not found`);
    return this.writeFields(doc.node.sourcePath, fields);
  }

  /** Rewrites frontmatter fields and rolls back if the result no longer validates. */
  private async writeFields(sourcePath: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    const { rel } = resolveInside(this.config.root, sourcePath);
    const original = await safeReadFile(this.config.root, rel);
    if (original === null) throw new Error(`document ${rel} no longer exists`);
    const next = setFrontmatterFields(original, fields);
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
