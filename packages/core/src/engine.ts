import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PrdmConfig } from './config.js';
import type { ParsedDoc, WorkOrderStatus } from './domain/schema.js';
import type { GraphStore } from './graph/types.js';
import { renameFrontmatterKey, setFrontmatterFields, type FieldValue } from './parser/frontmatter-edit.js';
import { parseDocument } from './parser/frontmatter.js';
import { scanDocuments, type ScanError, type ScanResult } from './parser/scan.js';
import { loadBaseline, saveBaseline } from './sync/baseline.js';
import { resolveGoverned, type CodeRefState } from './sync/code-refs.js';
import { dirtyPaths, readCommits } from './sync/git.js';
import { SymbolCache } from './sync/symbol-cache.js';
import { acknowledge, detectDrift, type DriftInput, type DriftIssue, type DriftResult, type GovernedState, type WorkOrderUpdate } from './sync/monitor.js';
import { resolveInside } from './util/paths.js';
import { withRepoLock } from './util/lock.js';
import {
  createJournal,
  deleteJournal,
  graphStaleMarkerExists,
  JOURNAL_DIR,
  journalCreate,
  journalReplace,
  removeGraphStaleMarker,
  replayOrphanJournals,
  rollback as rollbackJournal,
  writeGraphStaleMarker,
} from './util/journal.js';
import { safeReadFile, safeWriteFile } from './util/safe-fs.js';

/** Where a transaction's file writes go: direct (default) or journaled (atomic, so a mid-write crash can be rolled back). */
interface FileWriter {
  create(rel: string, content: string): Promise<void>;
  replace(rel: string, content: string): Promise<void>;
}

export interface RefreshReport {
  documents: number;
  errors: ScanError[];
  issues: DriftIssue[];
  governed: (GovernedState & { hash: string | null })[];
  workOrderUpdates: WorkOrderUpdate[];
  baselineWritten: boolean;
  hasBlockingIssues: boolean;
}

export interface BuiltRefreshReport {
  issues: DriftIssue[];
  governed: (GovernedState & { hash: string | null })[];
  workOrderUpdates: WorkOrderUpdate[];
  reviewNeeded: DriftResult['reviewNeeded'];
  baseline: DriftResult['baseline'];
}

/**
 * Pure core shared by `doInspect`/`doRefresh` (WO-123/SDD-007): runs `detectDrift` and stitches each governed
 * ref's current content hash back onto it (drift's own `governed` doesn't carry it). Does no I/O and never
 * touches `this`, so it is safe to call from a future `PgProjectEngine` too.
 */
export function buildRefreshReport(input: DriftInput): BuiltRefreshReport {
  const drift = detectDrift(input);
  const hashByKey = new Map([...input.governed].flatMap(([bp, refs]) => refs.map((r) => [`${bp}|${r.key}`, r.hash] as const)));
  const governed = drift.governed.map((g) => ({ ...g, hash: hashByKey.get(`${g.blueprintId}|${g.key}`) ?? null }));
  return { issues: drift.issues, governed, workOrderUpdates: drift.workOrderUpdates, reviewNeeded: drift.reviewNeeded, baseline: drift.baseline };
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
  /** Replaces an existing document's entire content (frontmatter + body), rejecting a result whose id changed or no longer validates. */
  replaceDocument(id: string, content: string): Promise<ParsedDoc>;
  refresh(): Promise<RefreshReport>;
  /** Read-only equivalent of `refresh()`: scans, detects drift and computes lifecycle issues without writing any status field, baseline or graph snapshot. */
  inspect(): Promise<RefreshReport>;
}

/** Everything a `ProjectEngine` needs from `PrdmConfig` except `root` and `neo4j` (SaaS values come from `projects.settings`, not a filesystem path or a database connection). */
export type ProjectSettings = Omit<PrdmConfig, 'root' | 'neo4j'>;

/**
 * Narrow port (WO-124/SDD-007) that every domain function (`generateWorkOrders`, `claimWorkOrder`, ...) is typed
 * against instead of the concrete, disk-bound `Engine`. Implemented locally by `Engine` unchanged, and later by a
 * Postgres-backed `PgProjectEngine` (SDD-007) with no local behavior change.
 */
export interface ProjectEngine {
  readonly settings: ProjectSettings;
  readonly store: GraphStore;
  transaction<T>(fn: (ops: EngineOps) => Promise<T>, options?: TransactionOptions): Promise<T>;
  refresh(): Promise<RefreshReport>;
  inspect(): Promise<RefreshReport>;
  /** Last computed report, read from saved state; never triggers a new scan/refresh (SDD-007: "estado guardado, nunca dispara refresh"). */
  lastReport(): Promise<RefreshReport | null>;
  acknowledge(target: string): Promise<RefreshReport>;
  recover(): Promise<RecoverResult>;
  scan(): Promise<ScanResult>;
}

export interface RecoverResult {
  /** Whether anything was actually rolled back or refreshed; false when there was nothing pending. */
  recovered: boolean;
  /** Journals found but never touched because they failed HMAC authentication (planted or corrupted), or entries skipped during rollback. */
  warnings: string[];
}

export interface TransactionOptions {
  /** Routes this transaction's file writes through a journal so any failure (incl. the final graph snapshot) rolls every write back. */
  atomic?: boolean;
}

export class Engine implements ProjectEngine {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly ops: EngineOps;
  private writer: FileWriter;
  /** Set at the end of `doRefresh`/`doInspect` (whichever path reached them: `refresh()`, `inspect()`, `acknowledge()` or a transaction's `ops.refresh()`/`ops.inspect()`), read by `lastReport()`. */
  private lastReportValue: RefreshReport | null = null;

  constructor(
    readonly config: PrdmConfig,
    readonly store: GraphStore,
  ) {
    this.writer = this.plainWriter();
    this.ops = {
      config,
      store,
      scan: () => scanDocuments(config.root, config.ignore),
      createDocument: (relPath, content) => this.createDocument(relPath, content),
      updateDocument: (id, fields) => this.updateDocument(id, fields),
      renameFrontmatterField: (id, oldKey, newKey) => this.renameFrontmatterField(id, oldKey, newKey),
      replaceDocument: (id, content) => this.replaceDocument(id, content),
      refresh: () => this.doRefresh(),
      inspect: () => this.doInspect(),
    };
  }

  /** `PrdmConfig` minus `root`/`neo4j`: the settings surface `ProjectEngine` callers may depend on (local-only fields are irrelevant to a future `PgProjectEngine`, which never has them at all). */
  get settings(): ProjectSettings {
    const { root: _root, neo4j: _neo4j, ...settings } = this.config;
    return settings;
  }

  scan(): Promise<ScanResult> {
    return scanDocuments(this.config.root, this.config.ignore);
  }

  /** Read-only, saved state; never recomputes (SDD-007). `null` until the first `refresh()`/`inspect()` of this process. */
  async lastReport(): Promise<RefreshReport | null> {
    return this.lastReportValue;
  }

  private plainWriter(): FileWriter {
    return {
      create: (rel, content) => safeWriteFile(this.config.root, rel, content, { exclusive: true }),
      replace: (rel, content) => safeWriteFile(this.config.root, rel, content),
    };
  }

  private journaledWriter(token: string): FileWriter {
    return {
      create: (rel, content) => journalCreate(this.config.root, this.config.docsDir, token, rel, content),
      replace: async (rel, content) => {
        const original = await safeReadFile(this.config.root, rel);
        if (original === null) throw new Error(`document ${rel} no longer exists`);
        await journalReplace(this.config.root, this.config.docsDir, token, rel, original, content);
      },
    };
  }

  /** Replays any authenticated journal left behind and, if the graph was left stale, refreshes it. Requires the repo lock. */
  private async recoverLocked(): Promise<RecoverResult> {
    const { rolledBack, warnings } = await replayOrphanJournals(this.config.root, this.config.docsDir);
    let refreshed = false;
    if (await graphStaleMarkerExists(this.config.root)) {
      await this.doRefresh();
      await removeGraphStaleMarker(this.config.root);
      refreshed = true;
    }
    return { recovered: rolledBack.length > 0 || refreshed, warnings };
  }

  /** Cheap to call on every read: only acquires the repo lock (and does any work) when a journal or stale marker is actually present. */
  async recover(): Promise<RecoverResult> {
    if (!(await this.hasPendingRecovery())) return { recovered: false, warnings: [] };
    return withRepoLock(this.config.root, () => this.recoverLocked());
  }

  private async hasPendingRecovery(): Promise<boolean> {
    if (await graphStaleMarkerExists(this.config.root)) return true;
    try {
      const names = await fs.readdir(join(this.config.root, JOURNAL_DIR));
      return names.some((n) => n.startsWith('journal-') && n.endsWith('.json'));
    } catch {
      return false;
    }
  }

  /**
   * Serializes mutations in-process (queue) and across processes (lockfile) so file writes and graph snapshots
   * never interleave. Every transaction first recovers any orphaned journal and stale-graph marker. With
   * `{ atomic: true }`, every file write `fn` performs through `ops` is journaled; a throw (including from the
   * final `ops.refresh()`) rolls every write of this transaction back and marks the graph stale before rethrowing.
   */
  transaction<T>(fn: (ops: EngineOps) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const run = this.queue.then(() => withRepoLock(this.config.root, () => this.runLocked(fn, options)));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runLocked<T>(fn: (ops: EngineOps) => Promise<T>, options: TransactionOptions): Promise<T> {
    await this.recoverLocked();
    if (!options.atomic) {
      this.writer = this.plainWriter();
      return fn(this.ops);
    }
    const token = await createJournal(this.config.root);
    this.writer = this.journaledWriter(token);
    try {
      const result = await fn(this.ops);
      await deleteJournal(this.config.root, token);
      return result;
    } catch (err) {
      // Written before attempting rollback: even if the rollback itself fails partway, the graph is already
      // durably marked stale, so the next refresh never silently treats a half-written repo as in sync (WO-023 finding 4).
      await writeGraphStaleMarker(this.config.root).catch(() => undefined);
      try {
        await rollbackJournal(this.config.root, this.config.docsDir, token);
      } catch (rollbackErr) {
        throw new AggregateError([err, rollbackErr], `transaction failed and its rollback also failed: ${(err as Error).message}`);
      }
      throw err;
    } finally {
      this.writer = this.plainWriter();
    }
  }

  refresh(): Promise<RefreshReport> {
    return this.transaction((ops) => ops.refresh());
  }

  /** Read-only equivalent of `refresh()`, safe to call without the repo lock (e.g. `closureReadiness`). */
  inspect(): Promise<RefreshReport> {
    return this.doInspect();
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

  private async collect(): Promise<{ scan: ScanResult; input: DriftInput; symbolCache: SymbolCache }> {
    const { root, ignore, gitMaxCommits } = this.config;
    const scan = await scanDocuments(root, ignore);
    const governed = new Map<string, CodeRefState[]>();
    const governWarnings: DriftInput['governWarnings'] = [];
    // SDD-004: loaded here so it's shared across every blueprint's resolveGoverned call in this refresh, and
    // written back at most once by whichever caller actually persists things (never by the read-only doInspect).
    const symbolCache = await SymbolCache.load(root);
    for (const doc of scan.docs.filter((d) => d.node.label === 'Blueprint')) {
      const { refs, warnings } = await resolveGoverned(root, doc.impactsPaths, ignore, { cache: symbolCache });
      governed.set(doc.node.id, refs);
      governWarnings.push(...warnings.map((message) => ({ blueprintId: doc.node.id, message })));
    }
    const [commits, dirty, baseline] = await Promise.all([readCommits(root, gitMaxCommits), dirtyPaths(root), loadBaseline(root)]);
    // WO-019: wires PRD-002 §3 lifecycle checking into refresh (see sync/monitor.ts detectDrift).
    return { scan, input: { docs: scan.docs, governed, governWarnings, baseline, commits, dirty, lifecycle: this.config.lifecycle }, symbolCache };
  }

  /**
   * Read-only: scans, detects drift and computes lifecycle issues but never writes a status field, a baseline
   * or a graph snapshot (WO-023 finding 9 — `closureReadiness` must not mutate anything).
   */
  private async doInspect(): Promise<RefreshReport> {
    const { scan, input } = await this.collect();
    const built = buildRefreshReport(input);
    const report: RefreshReport = {
      documents: scan.docs.length,
      errors: scan.errors,
      issues: built.issues,
      governed: built.governed,
      workOrderUpdates: built.workOrderUpdates,
      baselineWritten: false,
      hasBlockingIssues: scan.errors.length > 0 || built.issues.some((i) => i.severity === 'error'),
    };
    this.lastReportValue = report;
    return report;
  }

  private async doRefresh(): Promise<RefreshReport> {
    const { scan, input, symbolCache } = await this.collect();
    // Independent of whatever happens below: the parsing this refresh already did is real and safe to reuse,
    // even if the snapshot write or a status update fails later (WO-023's atomic-transaction guarantees are
    // about documents, not this purely-derived, self-healing cache).
    await symbolCache.saveIfDirty(this.config.root);
    const built = buildRefreshReport(input);

    const { applied, failures } = await this.applyStatusUpdates(built.workOrderUpdates);
    const statusById = new Map(applied.map((u) => [u.id, u.to]));
    const docs = scan.docs.map((d) => withStatus(d, statusById.get(d.node.id)));
    const issues = [...built.issues, ...failures];

    // Snapshot before baseline: if writeSnapshot throws (e.g. the store is unreachable), the baseline must stay
    // untouched so a retry recomputes the exact same drift instead of silently accepting it as newly acknowledged.
    await this.store.writeSnapshot({ docs, governed: built.governed, reviewNeeded: built.reviewNeeded, commits: input.commits });
    // A document that temporarily fails to parse would otherwise be pruned from the baseline and come back as "new" (drift silently accepted).
    const baselineWritten = scan.errors.length === 0 ? await saveBaseline(this.config.root, built.baseline) : false;

    const report: RefreshReport = {
      documents: docs.length,
      errors: scan.errors,
      issues,
      governed: built.governed,
      workOrderUpdates: applied,
      baselineWritten,
      hasBlockingIssues: scan.errors.length > 0 || issues.some((i) => i.severity === 'error'),
    };
    this.lastReportValue = report;
    return report;
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
    await this.writer.create(rel, content);
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

  /** Replaces a document's full content in one shot (frontmatter + body), used where a per-field rewrite can't express the change (e.g. a body edit). */
  private async replaceDocument(id: string, content: string): Promise<ParsedDoc> {
    const sourcePath = await this.sourcePathOf(id);
    const { rel } = resolveInside(this.config.root, sourcePath);
    const parsed = parseDocument(content, rel);
    if (!parsed?.ok) throw new Error(`replacement content for ${rel} is invalid: ${parsed ? parsed.error : 'frontmatter lost'}`);
    if (parsed.doc.node.id !== id) throw new Error(`replacement content must keep id ${id}, got ${parsed.doc.node.id}`);
    await this.writer.replace(rel, content);
    return parsed.doc;
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
    await this.writer.replace(rel, next);
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
