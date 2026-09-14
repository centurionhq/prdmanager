/**
 * `PgProjectEngine` (SDD-007 "PgProjectEngine"; WO-132): the Postgres-backed `ProjectEngine`
 * implementation the SaaS server runs, so every domain function in `@prdm/core`
 * (`generateWorkOrders`, `claimWorkOrder`, `completeWorkOrder`, `submitFeedback`,
 * `createFeatureRequest`, `attachArtifact`, `closureReadiness`, `closeFeature`) works unchanged
 * against either `Engine` (local, disk) or this class (SaaS, Postgres) since both only ever depend on
 * the narrow `ProjectEngine`/`EngineOps` ports.
 *
 * Scope of this WO: `settings`/`store`, `scan()` (published docs via `scanContents` + every doc_id in
 * any workflow state + `id_counters.last_seq`, so id allocation never collides with an open draft),
 * `transaction()` (Postgres transaction + `pg_advisory_xact_lock` keyed on the project uuid + an
 * in-process queue per project id, mirroring `Engine`'s own in-process queue), document writes
 * (`createDocument`/`updateDocument`/`renameFrontmatterField`/`replaceDocument`, all against
 * `documents`/`document_versions` rows, never a filesystem) and `readCommit` (only `trust = 'baseline'`
 * rows — SDD-010 owns actually populating `commits` from a verified CI report; until then this
 * correctly returns `null` for every sha, matching "commit_not_verified_by_ci" for anything not yet
 * baseline-trusted).
 *
 * `refresh()`/`inspect()`/`acknowledge()` are implemented here in a real but intentionally minimal
 * form (no code-governance state yet: `governed` is always empty and `dirty` is always empty, since
 * PgProjectEngine has no local git working tree to read `dirty` from at all) — WO-134 replaces the
 * `governed`/`commits` wiring with real CI-verified code state and hash-based reconciliation without
 * changing this file's transaction/scan/write plumbing.
 *
 * **Outbox projection (WO-133):** every write inside `withTx` only ever touches Postgres plus
 * `projects.graph_version`/`graph_dirty` (SDD-007: "dentro de la transacción solo se escribe
 * Postgres"). Once that transaction *commits*, `withTx` runs `projectIfDirty()` exactly once — this is
 * what coalesces any number of internal `ops.refresh()`/write calls made inside one outer
 * `transaction()` into a single post-commit projection, since `graph_dirty` is read fresh only after
 * every internal write already happened: there is nothing to coalesce in-process, the single boolean
 * column already *is* the coalescing. `projectIfDirty()` takes a **session-scoped**
 * `pg_advisory_lock` (a different lock key than `withTx`'s own per-transaction
 * `pg_advisory_xact_lock`, so new writers are never blocked behind an in-flight projection or vice
 * versa), re-reads the current `graph_dirty`/`graph_version` under that lock (in case a concurrent
 * projection from another process/instance already won the race while this one waited for the lock),
 * builds exactly one `GraphSnapshot` from the now-committed Postgres state, calls
 * `store.writeSnapshot()` once, then clears `graph_dirty` in a small follow-up transaction guarded by
 * `WHERE graph_version = $version` — so a newer write that lands between reading the snapshot and
 * clearing the flag is never incorrectly marked "already projected". `recover()` runs the exact same
 * `projectIfDirty()` (SDD-007: "recover() ... re-proyectan si graph_dirty"), so it's safe and cheap to
 * call on every read path — nothing to do when the project isn't dirty. A projection failure (e.g. the
 * graph store being unreachable) is reported through `onProjectionError` but never fails the caller's
 * already-committed Postgres write: `graph_dirty` simply stays `true` and the next `recover()` (or the
 * next write's own post-commit step) retries it — eventual consistency, never a lost/rolled-back write.
 */
import {
  acknowledge as acknowledgeDrift,
  buildRefreshReport,
  emptyBaseline,
  parseDocument,
  renameFrontmatterKey,
  scanContents,
  setFrontmatterFields,
  sha256,
  type Baseline,
  type CommitInfo,
  type DriftInput,
  type DriftIssue,
  type EngineOps,
  type FieldValue,
  type GraphSnapshot,
  type GraphStore,
  type ParsedDoc,
  type PrdmConfig,
  type ProjectEngine,
  type ProjectSettings,
  type RecoverResult,
  type RefreshReport,
  type ScanError,
  type ScannedFile,
  type ScanResult,
  type TransactionOptions,
  type WorkOrderUpdate,
} from '@prdm/core';
import { formatDocId, schema, withTenantTx, type PgDatabase } from '@prdm/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { saasProjectRoot } from './pg-project-settings.js';

type DocumentRow = typeof schema.documents.$inferSelect;
type DocumentKindValue = (typeof schema.documentKind.enumValues)[number];

/** `pg_advisory_xact_lock`/`pg_advisory_lock`'s single-bigint overload share one lock keyspace; two
 * different salts keep `withTx`'s per-transaction write lock and `projectIfDirty`'s session-scoped
 * projection lock from ever contending with each other for the same project (SDD-007: "un lock
 * distinto del transaccional" — a writer must never block behind an in-flight projection, or vice
 * versa). */
const WRITE_LOCK_SALT = 0;
const PROJECTION_LOCK_SALT = 1;

/** Extracts the numeric sequence out of a real `KIND-NNN` id (`FB-014` -> `14`); throws for anything
 * that isn't already a validated id, since every caller here only ever sees `ParsedDoc.node.id`. */
function seqOf(id: string): number {
  const seq = Number(id.split('-')[1]);
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`cannot derive a sequence number from id ${id}`);
  return seq;
}

/**
 * Serializes `PgProjectEngine.transaction()` calls in-process, per project id (mirrors `Engine`'s own
 * `this.queue`): the Postgres `pg_advisory_xact_lock` below already serializes across processes/server
 * instances, but without this a second concurrent call from the *same* process for the same project
 * would open a second pooled connection and simply block inside Postgres holding it — fine at low
 * concurrency, but a way to exhaust the pool under load that `Engine`'s own queue never has to worry
 * about locally. Module-level (not per-instance) since a new `PgProjectEngine` may be constructed per
 * request.
 */
const projectQueues = new Map<string, Promise<unknown>>();

function enqueueForProject<T>(projectId: string, run: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(projectId) ?? Promise.resolve();
  const next = previous.then(run, run);
  projectQueues.set(
    projectId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export interface PgProjectEngineOptions {
  pool: Pool;
  orgId: string;
  projectId: string;
  settings: ProjectSettings;
  store: GraphStore;
  /** Called when the post-commit outbox projection fails (SDD-007's outbox never fails the caller's
   * already-committed write for this — see this module's doc comment); defaults to writing a single
   * line to stderr so a failure is never silently swallowed even without a logger wired up. */
  onProjectionError?: (err: unknown) => void;
}

function defaultProjectionErrorHandler(err: unknown): void {
  process.stderr.write(`PgProjectEngine: graph projection failed, will retry on next write/recover(): ${(err as Error)?.message ?? String(err)}\n`);
}

async function loadScanState(tx: PgDatabase, projectId: string): Promise<ScanResult> {
  const rows = await tx
    .select({
      docId: schema.documents.docId,
      kind: schema.documents.kind,
      sourcePath: schema.documents.sourcePath,
      workflowState: schema.documents.workflowState,
      publishedRaw: schema.documents.publishedRaw,
    })
    .from(schema.documents)
    .where(eq(schema.documents.projectId, projectId));

  const publishedFiles: ScannedFile[] = rows
    .filter((r) => r.workflowState === 'published' && r.publishedRaw !== null)
    .map((r) => ({ path: r.sourcePath, content: r.publishedRaw as string }));
  const scanned = scanContents(publishedFiles);

  const counters = await tx
    .select({ kind: schema.idCounters.kind, lastSeq: schema.idCounters.lastSeq })
    .from(schema.idCounters)
    .where(eq(schema.idCounters.projectId, projectId));

  // SDD-007 "scan().ids incluye ... el last_seq de id_counters, de modo que nextId ... nunca choca con
  // un borrador": every doc_id in ANY workflow state (draft/in_review/published/archived), plus a
  // synthetic id for each kind's current counter value even if no document row actually uses it yet
  // (e.g. a rolled-back create that still advanced the counter, see `formatDocId`'s own doc comment).
  const ids = new Set<string>(scanned.ids);
  for (const row of rows) ids.add(row.docId);
  for (const counter of counters) if (counter.lastSeq > 0) ids.add(formatDocId(counter.kind, counter.lastSeq));

  const errors: ScanError[] = scanned.errors;
  return { docs: scanned.docs, errors, ids: [...ids] };
}

export class PgProjectEngine implements ProjectEngine {
  readonly settings: ProjectSettings;
  readonly store: GraphStore;
  private readonly pool: Pool;
  private readonly orgId: string;
  private readonly projectId: string;
  /** Never dereferenced for real disk/network I/O by this class's own `EngineOps` methods (only
   * `ops.config.folders`/`docsDir`/`lifecycle` and `triageText`'s `.triage` are ever read by domain
   * functions, per SDD-007's own audit of every `ops.config` use site) — kept `PrdmConfig`-shaped
   * rather than narrowing `EngineOps.config`'s type so `authoring/service.ts` (explicitly "solo local"
   * per SDD-007, and typed against the concrete `Engine`) keeps compiling unchanged. */
  private readonly config: PrdmConfig;
  private readonly onProjectionError: (err: unknown) => void;

  constructor(opts: PgProjectEngineOptions) {
    this.pool = opts.pool;
    this.orgId = opts.orgId;
    this.projectId = opts.projectId;
    this.settings = opts.settings;
    this.store = opts.store;
    this.onProjectionError = opts.onProjectionError ?? defaultProjectionErrorHandler;
    this.config = {
      ...opts.settings,
      root: saasProjectRoot(opts.projectId),
      neo4j: { uri: 'saas://unused', username: 'unused', password: 'unused', database: 'unused' },
    };
  }

  scan(): Promise<ScanResult> {
    return withTenantTx(this.pool, this.orgId, (tx) => loadScanState(tx, this.projectId));
  }

  /** Read-only, saved state; never recomputes (SDD-007) and this WO does not yet persist a saved
   * report anywhere durable, so it always answers `null` until a future WO adds that (mirrors
   * `Engine.lastReport()` before its own first `refresh()`/`inspect()` of the process). */
  async lastReport(): Promise<RefreshReport | null> {
    return null;
  }

  /** No local git working tree/journal to recover from a crash of the caller's *own* process (nothing
   * here can partially commit — a crashed transaction simply rolls back on its own); the only durable
   * thing a crash can leave behind is `graph_dirty = true` with no projection having run yet, which is
   * exactly what `projectIfDirty()` fixes. Cheap to call on every read path (SDD-007), since it's a
   * no-op whenever the project isn't dirty. */
  async recover(): Promise<RecoverResult> {
    const recovered = await this.projectIfDirty();
    return { recovered, warnings: [] };
  }

  transaction<T>(fn: (ops: EngineOps) => Promise<T>, _options: TransactionOptions = {}): Promise<T> {
    return this.withTx((_tx, ops) => fn(ops));
  }

  refresh(): Promise<RefreshReport> {
    return this.withTx((tx) => this.doRefreshOrInspect(tx, true));
  }

  /** Unlike `refresh()`, read-only and safe without the advisory lock (mirrors `Engine.inspect()`). */
  async inspect(): Promise<RefreshReport> {
    return withTenantTx(this.pool, this.orgId, (tx) => this.doRefreshOrInspect(tx, false));
  }

  acknowledge(target: string): Promise<RefreshReport> {
    return this.withTx(async (tx) => {
      const scan = await loadScanState(tx, this.projectId);
      if (scan.errors.length > 0) throw new Error(`fix ${scan.errors.length} invalid document(s) before acknowledging`);
      const input = await this.buildDriftInput(tx, scan);
      const result = acknowledgeDrift(input, target);
      for (const update of result.workOrderHashUpdates) {
        await this.writeGeneratedFields(tx, update.id, { blueprint_hashes: update.blueprintHashes });
      }
      await this.saveBaseline(tx, result.baseline);
      return this.doRefreshOrInspect(tx, true);
    });
  }

  private withTx<T>(fn: (tx: PgDatabase, ops: EngineOps) => Promise<T>): Promise<T> {
    return enqueueForProject(this.projectId, async () => {
      const result = await withTenantTx(this.pool, this.orgId, async (tx) => {
        // Deterministic per-project lock key (SDD-007: "pg_advisory_xact_lock sobre el uuid del
        // proyecto"); hashtextextended never truncates a uuid string the way int4/int8 casts of its
        // bytes could collide more easily.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${this.projectId}::text, ${WRITE_LOCK_SALT}))`);
        return fn(tx, this.buildOps(tx));
      });
      // Only after the transaction above has actually committed (SDD-007's outbox): any number of
      // internal writes already collapsed into a single `graph_dirty = true`, so this is the one
      // place per outer `transaction()`/`refresh()`/`acknowledge()` call that can ever trigger a
      // projection — never once per internal `ops.refresh()`/write call.
      try {
        await this.projectIfDirty();
      } catch (err) {
        this.onProjectionError(err);
      }
      return result;
    });
  }

  /** Projects the current committed Postgres state to the graph store exactly once if (and only if)
   * `graph_dirty` is currently set, under a session-scoped advisory lock so two concurrent callers
   * (different processes, or `recover()` racing a write's own post-commit step) never call
   * `store.writeSnapshot` for the same project at the same time. Returns whether it actually projected
   * anything. */
  private async projectIfDirty(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('select pg_advisory_lock(hashtextextended($1::text, $2))', [this.projectId, PROJECTION_LOCK_SALT]);
      return await this.projectOnce();
    } finally {
      await client.query('select pg_advisory_unlock(hashtextextended($1::text, $2))', [this.projectId, PROJECTION_LOCK_SALT]);
      client.release();
    }
  }

  /** Must only be called while holding the session projection lock (see `projectIfDirty`). Re-checks
   * `graph_dirty` under the lock (a concurrent projection may have already won the race while this
   * call waited for the lock), builds one snapshot from the now-committed state, writes it once, then
   * clears `graph_dirty` guarded by `graph_version = $version` so a write that lands after the
   * snapshot was read is never incorrectly marked as already projected. */
  private async projectOnce(): Promise<boolean> {
    const state = await withTenantTx(this.pool, this.orgId, async (tx) => {
      const [row] = await tx.select({ dirty: schema.projects.graphDirty, version: schema.projects.graphVersion }).from(schema.projects).where(eq(schema.projects.id, this.projectId));
      if (!row) throw new Error(`project ${this.projectId} not found while checking graph_dirty`);
      if (!row.dirty) return null;
      const snapshot = await this.buildSnapshot(tx);
      return { version: row.version, snapshot };
    });
    if (!state) return false;

    await this.store.writeSnapshot(state.snapshot);

    await withTenantTx(this.pool, this.orgId, (tx) =>
      tx
        .update(schema.projects)
        .set({ graphDirty: false })
        .where(and(eq(schema.projects.id, this.projectId), eq(schema.projects.graphVersion, state.version))),
    );
    return true;
  }

  private async buildSnapshot(tx: PgDatabase): Promise<GraphSnapshot> {
    const scan = await loadScanState(tx, this.projectId);
    const input = await this.buildDriftInput(tx, scan);
    const built = buildRefreshReport(input);
    return { docs: scan.docs, governed: built.governed, reviewNeeded: built.reviewNeeded, commits: input.commits };
  }

  private buildOps(tx: PgDatabase): EngineOps {
    return {
      config: this.config,
      store: this.store,
      scan: () => loadScanState(tx, this.projectId),
      createDocument: (relPath, content) => this.createDocument(tx, relPath, content),
      updateDocument: (id, fields) => this.updateDocumentFields(tx, id, fields),
      renameFrontmatterField: (id, oldKey, newKey) => this.renameField(tx, id, oldKey, newKey),
      replaceDocument: (id, content) => this.replace(tx, id, content),
      refresh: () => this.doRefreshOrInspect(tx, true),
      inspect: () => this.doRefreshOrInspect(tx, false),
      readCommit: (sha) => this.readCommit(tx, sha),
    };
  }

  private async findDocumentRow(tx: PgDatabase, docId: string): Promise<DocumentRow> {
    const [row] = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.projectId, this.projectId), eq(schema.documents.docId, docId)));
    if (!row) throw new Error(`document ${docId} not found`);
    return row;
  }

  private async markGraphDirty(tx: PgDatabase): Promise<void> {
    await tx
      .update(schema.projects)
      .set({ graphVersion: sql`${schema.projects.graphVersion} + 1`, graphDirty: true })
      .where(eq(schema.projects.id, this.projectId));
  }

  private async bumpIdCounter(tx: PgDatabase, kind: DocumentKindValue, seq: number): Promise<void> {
    // SDD-007 "createDocument avanza id_counters con GREATEST en la misma transacción": keeps the
    // counter's `last_seq` from ever lagging behind an id a document actually used, regardless of
    // ordering, without a separate row lock (the unique `(project_id, kind)` constraint plus
    // `GREATEST` makes this safe under concurrent inserts for different kinds; same-kind inserts are
    // already serialized by this project's advisory lock).
    await tx.execute(sql`
      insert into "id_counters" ("project_id", "org_id", "kind", "last_seq")
      values (${this.projectId}, ${this.orgId}, ${kind}, ${seq})
      on conflict ("project_id", "kind")
      do update set "last_seq" = greatest("id_counters"."last_seq", excluded."last_seq")
    `);
  }

  /** `EngineOps.createDocument`: only ever called by generator domain functions (`generateWorkOrders`,
   * `submitFeedback`, `createFeatureRequest`, `attachArtifact` — SDD-007 "Documentos generados"), so the
   * resulting row is always `origin: 'generated'`, published immediately (no human review step) and its
   * first version has `reason: 'engine_write'`. */
  private async createDocument(tx: PgDatabase, relPath: string, content: string): Promise<ParsedDoc> {
    const docsPrefix = `${this.settings.docsDir}/`;
    if (!relPath.startsWith(docsPrefix) || !relPath.endsWith('.md')) {
      throw new Error(`documents must be created as .md files under ${docsPrefix}`);
    }
    const parsed = parseDocument(content, relPath);
    if (!parsed) throw new Error('document content has no graph frontmatter (id/type)');
    if (!parsed.ok) throw new Error(`invalid document: ${parsed.error}`);
    const doc = parsed.doc;

    const existing = await loadScanState(tx, this.projectId);
    if (existing.ids.includes(doc.node.id)) throw new Error(`document ${doc.node.id} already exists`);

    const contentHash = sha256(content);
    const [row] = await tx
      .insert(schema.documents)
      .values({
        orgId: this.orgId,
        projectId: this.projectId,
        docId: doc.node.id,
        kind: doc.node.kind,
        title: doc.node.title,
        sourcePath: relPath,
        origin: 'generated',
        workflowState: 'published',
        publishedRaw: content,
        publishedContentHash: contentHash,
      })
      .returning();
    if (!row) throw new Error(`failed to insert document row for ${doc.node.id}`);

    const [version] = await tx
      .insert(schema.documentVersions)
      .values({
        orgId: this.orgId,
        documentId: row.id,
        versionNo: 1,
        reason: 'engine_write',
        renderedMarkdown: content,
        frontmatter: doc.frontmatter,
        contentHash,
        contributors: [],
      })
      .returning();
    if (!version) throw new Error(`failed to insert version row for ${doc.node.id}`);

    await tx.update(schema.documents).set({ publishedVersionId: version.id }).where(eq(schema.documents.id, row.id));
    await this.bumpIdCounter(tx, doc.node.kind, seqOf(doc.node.id));
    await this.markGraphDirty(tx);
    return doc;
  }

  private async updateDocumentFields(tx: PgDatabase, id: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    return this.writeGeneratedFields(tx, id, fields);
  }

  private async writeGeneratedFields(tx: PgDatabase, id: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    const row = await this.findDocumentRow(tx, id);
    if (row.publishedRaw === null) throw new Error(`document ${id} has no published content to update`);
    return this.writeGeneratedContent(tx, row, setFrontmatterFields(row.publishedRaw, fields));
  }

  private async renameField(tx: PgDatabase, id: string, oldKey: string, newKey: string): Promise<ParsedDoc> {
    const row = await this.findDocumentRow(tx, id);
    if (row.publishedRaw === null) throw new Error(`document ${id} has no published content to update`);
    return this.writeGeneratedContent(tx, row, renameFrontmatterKey(row.publishedRaw, oldKey, newKey));
  }

  /** `EngineOps.replaceDocument`: same immutable-id guarantee as `Engine.replaceDocument`. */
  private async replace(tx: PgDatabase, id: string, content: string): Promise<ParsedDoc> {
    const row = await this.findDocumentRow(tx, id);
    const parsed = parseDocument(content, row.sourcePath);
    if (!parsed?.ok) throw new Error(`replacement content for ${row.sourcePath} is invalid: ${parsed ? parsed.error : 'frontmatter lost'}`);
    if (parsed.doc.node.id !== id) throw new Error(`replacement content must keep id ${id}, got ${parsed.doc.node.id}`);
    return this.writeGeneratedContent(tx, row, content, parsed.doc);
  }

  /** Freezes a new `document_versions` row (`reason: 'engine_write'`) and updates the document's
   * published columns; shared by every `EngineOps` write that rewrites an already-published, engine
   * generated document's content in place. */
  private async writeGeneratedContent(tx: PgDatabase, row: DocumentRow, nextContent: string, parsedDoc?: ParsedDoc): Promise<ParsedDoc> {
    const parsed = parsedDoc ?? this.reparseOrThrow(row.sourcePath, nextContent);
    const contentHash = sha256(nextContent);
    const [maxRow] = await tx
      .select({ maxVersionNo: sql<number>`coalesce(max(${schema.documentVersions.versionNo}), 0)` })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, row.id));

    const [version] = await tx
      .insert(schema.documentVersions)
      .values({
        orgId: this.orgId,
        documentId: row.id,
        versionNo: (maxRow?.maxVersionNo ?? 0) + 1,
        reason: 'engine_write',
        renderedMarkdown: nextContent,
        frontmatter: parsed.frontmatter,
        contentHash,
        contributors: [],
      })
      .returning();
    if (!version) throw new Error(`failed to insert version row for ${row.docId}`);

    await tx
      .update(schema.documents)
      .set({ publishedRaw: nextContent, publishedContentHash: contentHash, publishedVersionId: version.id, updatedAt: new Date() })
      .where(eq(schema.documents.id, row.id));
    await this.markGraphDirty(tx);
    return parsed;
  }

  private reparseOrThrow(sourcePath: string, content: string): ParsedDoc {
    const parsed = parseDocument(content, sourcePath);
    if (!parsed?.ok) throw new Error(`update would invalidate ${sourcePath}: ${parsed ? parsed.error : 'frontmatter lost'}`);
    return parsed.doc;
  }

  /** `EngineOps.readCommit` (SDD-007): only commits that arrived through a CI-verified baseline report
   * (SDD-010, not yet built) are ever visible; anything else — including a sha real in git but never
   * reported, or reported only as an unverified preview — answers `null` here exactly like an unknown
   * sha would, since `EngineOps.readCommit`'s contract is "a resolvable commit or nothing", and SDD-010
   * is what will actually populate `commits` rows with `trust`s other than `'baseline'`. */
  private async readCommit(tx: PgDatabase, sha: string): Promise<CommitInfo | null> {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
    const [row] = await tx
      .select()
      .from(schema.commits)
      .where(and(eq(schema.commits.projectId, this.projectId), eq(schema.commits.sha, sha), eq(schema.commits.trust, 'baseline')));
    if (!row) return null;
    return { sha: row.sha, author: row.author, date: row.date.toISOString(), subject: row.subject, refs: row.refs, files: row.files };
  }

  private async loadBaseline(tx: PgDatabase): Promise<Baseline> {
    const [row] = await tx.select().from(schema.projectBaselines).where(eq(schema.projectBaselines.projectId, this.projectId));
    return (row?.baseline as Baseline | undefined) ?? emptyBaseline();
  }

  private async saveBaseline(tx: PgDatabase, baseline: Baseline): Promise<void> {
    await tx
      .insert(schema.projectBaselines)
      .values({ projectId: this.projectId, orgId: this.orgId, baseline, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.projectBaselines.projectId, set: { baseline, updatedAt: new Date() } });
  }

  private async loadBaselineCommits(tx: PgDatabase): Promise<CommitInfo[]> {
    const rows = await tx
      .select()
      .from(schema.commits)
      .where(and(eq(schema.commits.projectId, this.projectId), eq(schema.commits.trust, 'baseline')));
    return rows
      .map((row): CommitInfo => ({ sha: row.sha, author: row.author, date: row.date.toISOString(), subject: row.subject, refs: row.refs, files: row.files }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * WO-134 replaces `governed`/`governWarnings` with real CI-verified code state
   * (`project_code_state`/hash-based reconciliation); until then this always reports "no code
   * governance data" rather than fabricating a synced/out-of-sync state it cannot actually verify —
   * `detectDrift` treats an empty `governed` map as "nothing to check", never as "everything is fine".
   * `dirty` (uncommitted local changes) has no SaaS equivalent at all (there is no local working tree),
   * so it is always empty.
   */
  private async buildDriftInput(tx: PgDatabase, scan: ScanResult): Promise<DriftInput> {
    const [baseline, commits] = await Promise.all([this.loadBaseline(tx), this.loadBaselineCommits(tx)]);
    return {
      docs: scan.docs,
      governed: new Map(),
      governWarnings: [],
      baseline,
      commits,
      dirty: new Set(),
      lifecycle: this.settings.lifecycle,
    };
  }

  private async doRefreshOrInspect(tx: PgDatabase, persist: boolean): Promise<RefreshReport> {
    const scan = await loadScanState(tx, this.projectId);
    const input = await this.buildDriftInput(tx, scan);
    const built = buildRefreshReport(input);

    if (!persist) {
      return {
        documents: scan.docs.length,
        errors: scan.errors,
        issues: built.issues,
        governed: built.governed,
        workOrderUpdates: built.workOrderUpdates,
        baselineWritten: false,
        hasBlockingIssues: scan.errors.length > 0 || built.issues.some((i) => i.severity === 'error'),
      };
    }

    const { applied, failures } = await this.applyStatusUpdates(tx, built.workOrderUpdates);
    const issues: DriftIssue[] = [...built.issues, ...failures];
    // Mirrors `Engine.doRefresh`: a document that temporarily fails to parse must not be silently
    // pruned from the baseline (it would come back as "new" — drift silently accepted).
    const baselineWritten = scan.errors.length === 0;
    if (baselineWritten) await this.saveBaseline(tx, built.baseline);

    return {
      documents: scan.docs.length,
      errors: scan.errors,
      issues,
      governed: built.governed,
      workOrderUpdates: applied,
      baselineWritten,
      hasBlockingIssues: scan.errors.length > 0 || issues.some((i) => i.severity === 'error'),
    };
  }

  private async applyStatusUpdates(tx: PgDatabase, updates: WorkOrderUpdate[]): Promise<{ applied: WorkOrderUpdate[]; failures: DriftIssue[] }> {
    const applied: WorkOrderUpdate[] = [];
    const failures: DriftIssue[] = [];
    for (const update of updates) {
      try {
        await this.writeGeneratedFields(tx, update.id, { status: update.to });
        applied.push(update);
      } catch (err) {
        failures.push({ kind: 'status_write_failed', severity: 'error', nodeId: update.id, message: `could not set ${update.id} to ${update.to}: ${(err as Error).message}` });
      }
    }
    return { applied, failures };
  }
}

/** Convenience factory (WO-132): builds `config`/`root`/store fingerprint consistently, so callers
 * (route handlers, the WO-135 contract suite) never hand-assemble a `PgProjectEngine`. */
export function createPgProjectEngine(opts: PgProjectEngineOptions): PgProjectEngine {
  return new PgProjectEngine(opts);
}
