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
 * `refresh()`/`inspect()`/`acknowledge()`: `dirty` is always empty — PgProjectEngine has no local git
 * working tree to read it from at all. `governed` (WO-334, SDD-012) is loaded from `project_code_refs`,
 * the per-blueprint state a baseline code report persists (WO-333); see `buildDriftInput`/`loadGoverned`.
 * Independently, reconciliation-by-hash at the `impacts_paths`-signature level (WO-134) still guards
 * `governed` against a blueprint whose design changed since the report that produced its refs:
 * `project_code_state`'s stored hash per blueprint (from the last report that covered it) is compared
 * against each published blueprint's current `impacts_paths`; a mismatch (including "never reported")
 * produces a non-blocking `awaiting_ci_report` issue, excludes that blueprint's rows from `governed`
 * entirely for this refresh (see `loadGoverned`'s `excludeBlueprintIds`), and leaves its
 * `baseline.governs` entry untouched, rather than fabricating a reconciliation the CI report hasn't
 * actually happened. See `reconcileByHash`/`preserveStaleGoverns`.
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
 *
 * **`collab`-origin field writes (WO-139 → WO-250):** `writeGeneratedFields`/`renameField`/`replace` all
 * guard on the target document's `origin` first. A `generated`-origin document (a WO, or
 * feedback/artifacts the MCP surface creates) has no working copy at all, so a direct write is exactly
 * correct, unchanged since WO-132. A `collab`-origin document (human-authored via WO-136) might have one,
 * so `writeGeneratedFields` splits the requested fields in two (see `isServerManagedField`):
 *
 * - **Server-managed fields** (`closeFeature`'s `status`/`closed_at`/`closed_by`, or `status` being set to
 *   any other `FORBIDDEN_TERMINAL_STATUS` value) are never something a human types into the Y.Doc — SDD-008
 *   keeps them out of it entirely by design — so there is nothing a rollback needs to protect here: they're
 *   written straight to `published_raw` (`writeServerManagedCollabFields`, reusing the same
 *   `setFrontmatterFields`/`writeGeneratedContent`/`reason: 'engine_write'` path a `generated`-origin write
 *   already uses), which is what makes the change visible to `scan()`/drift/graph/MCP immediately, with no
 *   dependency on anyone ever opening this document's editor (WO-250: this is exactly what was missing —
 *   `closeFeature` used to only ever reach `pending_editable_patch`, invisible to all of those until, and
 *   unless, someone happened to open the live editor). If a Hocuspocus instance is wired up
 *   (`PgProjectEngineOptions.hocuspocus`), the equivalent change is additionally queued in
 *   `pendingLiveDocSyncs` and applied to the document's live `Y.Doc` as a real, `system:engine`-attributed
 *   transaction (same `openDirectConnection` + scratch-doc-diffed-against-the-live-state-vector pattern as
 *   `../collab/restore.ts`/`../collab/accept-agent-proposal.ts`) — but only once `withTx`'s surrounding
 *   Postgres transaction has actually committed, never before: a change already broadcast to a live `Y.Doc`
 *   can't be undone if that transaction later rolls back, the same invariant WO-139 was protecting.
 * - **Genuinely Y.Doc-editable fields** (`createFeatureRequest`'s `informs` link-back today — anything not
 *   in `FORBIDDEN_STATIC_FIELDS`/`FORBIDDEN_TERMINAL_STATUS`) keep going through
 *   `queuePendingEditablePatch`, unchanged since WO-139: merged into `documents.pending_editable_patch`,
 *   idempotent, rolled back for free by Postgres like any other write in this same transaction, and
 *   deliberately inert until a live editor actually opens this document (`../collab/persistence.ts`'s
 *   `onLoadDocument`) — correct for a field a human is meant to keep editing live, wrong for a
 *   server-managed one, which is exactly why WO-250 split the two.
 */
import {
  acknowledge as acknowledgeDrift,
  buildRefreshReport,
  emptyBaseline,
  FORBIDDEN_STATIC_FIELDS,
  FORBIDDEN_TERMINAL_STATUS,
  parseDocument,
  renameFrontmatterKey,
  scanContents,
  setFrontmatterFields,
  sha256,
  type Baseline,
  type CodeRefState,
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
import { formatDocId, schema, seedIdCounterAtLeast, withTenantTx, type PgDatabase } from '@prdm/db';
import { assertValidRoot, createDocumentYDoc, decodeUpdateRanges, FRONTMATTER_ROOT, InvalidDocumentRootError, type FrontmatterValue } from '@prdm/collab';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Hocuspocus } from '@hocuspocus/server';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import { formatDocumentName } from '../collab/document-name.js';
import { saasProjectRoot } from './pg-project-settings.js';

type DocumentRow = typeof schema.documents.$inferSelect;
type DocumentKindValue = (typeof schema.documentKind.enumValues)[number];

/** `pg_advisory_xact_lock`/`pg_advisory_lock`'s single-bigint overload share one lock keyspace; two
 * different salts keep `withTx`'s per-transaction write lock and `projectIfDirty`'s session-scoped
 * projection lock from ever contending with each other for the same project (SDD-007: "un lock
 * distinto del transaccional" — a writer must never block behind an in-flight projection, or vice
 * versa).
 *
 * `WRITE_LOCK_SALT`'s literal value (0) is duplicated in `@prdm/db`'s
 * `project-code-state-repository.ts` (WO-233: `recordBaselineHead`'s read-modify-write takes this exact
 * same lock so it can never race a concurrent baseline report's own `impacts_hashes` merge) — keep both
 * in sync by hand, same cross-package convention already used for `collab/`'s `DOC_UPDATES_LOCK_SALT`. */
const WRITE_LOCK_SALT = 0;
const PROJECTION_LOCK_SALT = 1;

/** WO-250: same salt/keyspace as `../collab/doc-update-writer.ts`/`../collab/restore.ts`/
 * `../collab/accept-agent-proposal.ts`'s own `DOC_UPDATES_LOCK_SALT` ('PDU0') — `applyServerManagedFieldsToLiveDoc`
 * durably writes its own `doc_updates` row the same way those do (a direct Hocuspocus connection has no
 * `beforeSync` hook to do it for them), so it must take the exact same per-document advisory lock they do
 * to serialize against a concurrent live edit's own `doc_updates.seq` allocation. Duplicated by hand
 * across files/packages, same convention as `WRITE_LOCK_SALT` above. */
const DOC_UPDATES_LOCK_SALT = 0x5044_5530; // 'PDU0'

/** A fresh, unregistered 32-bit Yjs client id (WO-250) — same generation shape used by
 * `../collab/restore.ts`/`../collab/accept-agent-proposal.ts` (each file keeps its own tiny copy rather
 * than sharing one; `generateNewClientId` isn't part of `yjs`'s public API surface). */
function freshClientId(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

/** `system:engine` (WO-250), matching `../collab/persistence.ts`'s own `PENDING_PATCH_ORIGIN` value
 * (SDD-008 §"Autoría por línea no falsificable": a server-attributed transaction, never a real
 * connection's client id) — kept as a separately-defined constant rather than importing it from a
 * Hocuspocus-extension module into this engine-layer one, same "duplicated by hand, kept in sync"
 * convention as the lock salts above. */
const ENGINE_WRITE_ORIGIN = 'system:engine';

/**
 * WO-250: a field a `collab`-origin document's engine write touches is "server-managed" — and therefore
 * safe (and correct) to write directly to `published_raw` rather than queue in `pending_editable_patch`
 * — exactly when it's one of the identity/lifecycle/provenance fields `@prdm/core`'s
 * `FORBIDDEN_STATIC_FIELDS` already says a human draft may never set directly (SDD-002 "Ciclo de vida":
 * `closed_at`/`closed_by`/`assigned_to`/`claimed_at`/`completed_at`/`resolved_by`/`blueprint_hashes`/
 * `source_task`), or `status` being set to one of `FORBIDDEN_TERMINAL_STATUS`'s lifecycle-managed terminal
 * values (`closeFeature`'s own `status: 'closed'`) — `status` is otherwise a plain human-editable field
 * for any non-terminal value. Grounded in exactly what the two real callers of `ops.updateDocument`
 * against a `collab`-origin document pass today: `closeFeature` (`status`/`closed_at`/`closed_by`, all
 * server-managed) and `createFeatureRequest`'s `informs` link-back (not server-managed — a human can
 * freely draft `informs`, per `FORBIDDEN_STATIC_FIELDS` not including it — so it keeps going through
 * `queuePendingEditablePatch` unchanged).
 */
function isServerManagedField(key: string, value: FieldValue): boolean {
  if (FORBIDDEN_STATIC_FIELDS.has(key)) return true;
  return key === 'status' && typeof value === 'string' && FORBIDDEN_TERMINAL_STATUS.has(value);
}

/** Extracts the numeric sequence out of a real `KIND-NNN` id (`FB-014` -> `14`); throws for anything
 * that isn't already a validated id, since every caller here only ever sees `ParsedDoc.node.id`. */
function seqOf(id: string): number {
  const seq = Number(id.split('-')[1]);
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`cannot derive a sequence number from id ${id}`);
  return seq;
}

/** Order-independent hash of a blueprint's `impacts_paths` (WO-134's reconciliation-by-hash): a plain
 * signature of *what a blueprint currently claims to govern*, never of any actual code content, so it
 * can be computed here with zero source access and compared against whatever `project_code_state`
 * recorded as of the last CI report (SDD-010) that covered this blueprint. */
function impactsPathsHash(paths: readonly string[]): string {
  return sha256(JSON.stringify([...paths].sort()));
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
  /** WO-334: the project's current `hash_algo_version` setting (`@prdm/contracts`'
   * `projectSettingsSchema`, not part of core's own `ProjectSettings`, hence a separate option) —
   * `buildDriftInput` never treats a `project_code_refs` row computed under a since-changed hash
   * algorithm as current, the same "never trust a stale signature" reasoning `awaiting_ci_report`
   * already applies to `impacts_paths` hashes. Defaults to `1` (`projectSettingsSchema`'s own default)
   * for callers (mostly tests) that construct a `PgProjectEngine` without a real project settings row. */
  hashAlgoVersion?: number;
  /** WO-250: the server's live `Hocuspocus` instance, used only to apply a server-managed collab-field
   * write (see `isServerManagedField`) to a document's live `Y.Doc` once the underlying Postgres write has
   * committed (`applyServerManagedFieldsToLiveDoc`). Optional: `undefined` in any context that never
   * touches a real-time collab server (CLI/MCP-remote read paths, most tests) — `published_raw` is always
   * written directly either way, so `scan()`/drift/graph/MCP see a server-managed write immediately
   * regardless; only an already-open live editor stays stale (until reload) without this wired up. */
  hocuspocus?: Hocuspocus;
  /** Called when the post-commit outbox projection fails (SDD-007's outbox never fails the caller's
   * already-committed write for this — see this module's doc comment); defaults to writing a single
   * line to stderr so a failure is never silently swallowed even without a logger wired up. */
  onProjectionError?: (err: unknown) => void;
  /** WO-250: called when applying a server-managed collab-field write to a document's live `Y.Doc` fails
   * after the underlying Postgres write already committed — same "never fail the caller's already-
   * committed write" contract as `onProjectionError` (see this module's doc comment): the `published_raw`
   * write already succeeded and is what `scan()`/drift/graph/MCP read, so a failure here only ever means a
   * currently-open live editor stays stale until it reloads. Defaults to a single stderr line, same shape
   * as `onProjectionError`'s own default. */
  onLiveDocSyncError?: (err: unknown) => void;
}

function defaultProjectionErrorHandler(err: unknown): void {
  process.stderr.write(`PgProjectEngine: graph projection failed, will retry on next write/recover(): ${(err as Error)?.message ?? String(err)}\n`);
}

function defaultLiveDocSyncErrorHandler(err: unknown): void {
  process.stderr.write(`PgProjectEngine: applying a server-managed field write to a document's live Y.Doc failed (published_raw already committed): ${(err as Error)?.message ?? String(err)}\n`);
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
  private readonly onLiveDocSyncError: (err: unknown) => void;
  private readonly hocuspocus: Hocuspocus | undefined;
  private readonly hashAlgoVersion: number;
  /** WO-250: server-managed collab-field writes queued by `writeServerManagedCollabFields` during the
   * current `withTx` call, applied to each document's live `Y.Doc` only *after* the enclosing Postgres
   * transaction actually commits (see `withTx`). Reset at the start of every `withTx` call; safe as a
   * plain instance field despite `PgProjectEngine` not being otherwise re-entrant-safe because
   * `enqueueForProject` already guarantees at most one `withTx` call is ever in flight for this project id
   * at a time, across every instance. */
  private pendingLiveDocSyncs: Array<{ documentId: string; fields: Record<string, FieldValue> }> = [];

  constructor(opts: PgProjectEngineOptions) {
    this.pool = opts.pool;
    this.orgId = opts.orgId;
    this.projectId = opts.projectId;
    this.settings = opts.settings;
    this.store = opts.store;
    this.hocuspocus = opts.hocuspocus;
    this.hashAlgoVersion = opts.hashAlgoVersion ?? 1;
    this.onProjectionError = opts.onProjectionError ?? defaultProjectionErrorHandler;
    this.onLiveDocSyncError = opts.onLiveDocSyncError ?? defaultLiveDocSyncErrorHandler;
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
      this.pendingLiveDocSyncs = [];
      const result = await withTenantTx(this.pool, this.orgId, async (tx) => {
        // Deterministic per-project lock key (SDD-007: "pg_advisory_xact_lock sobre el uuid del
        // proyecto"); hashtextextended never truncates a uuid string the way int4/int8 casts of its
        // bytes could collide more easily.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${this.projectId}::text, ${WRITE_LOCK_SALT}))`);
        return fn(tx, this.buildOps(tx));
      });
      // WO-250: only now that the transaction above has actually committed can any server-managed
      // collab-field write queued during it safely reach its document's live Y.Doc — never before, the
      // same "a broadcast change can't be undone by a later rollback" invariant `writeServerManagedCollabFields`'s
      // own doc comment explains. A failure here (e.g. Hocuspocus temporarily unreachable) never undoes or
      // fails the caller's already-committed `published_raw` write — `scan()`/drift/graph/MCP already see
      // it; only a currently-open live editor stays stale until it reloads.
      const liveDocSyncs = this.pendingLiveDocSyncs;
      this.pendingLiveDocSyncs = [];
      for (const sync of liveDocSyncs) {
        try {
          await this.applyServerManagedFieldsToLiveDoc(sync.documentId, sync.fields);
        } catch (err) {
          this.onLiveDocSyncError(err);
        }
      }
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

  /** WO-251: delegates to `@prdm/db`'s `seedIdCounterAtLeast` — the exact same `INSERT ... ON CONFLICT
   * (project_id, kind) DO UPDATE SET last_seq = GREATEST(...)` upsert `import-repository.ts` already uses
   * — rather than hand-duplicating that SQL here with `org_id` sourced from `this.orgId` instead of
   * `seedIdCounterAtLeast`'s own `current_setting('app.org_id', true)`. The two are never actually
   * different values in practice: every call into `bumpIdCounter` already runs inside a
   * `withTenantTx(this.pool, this.orgId, ...)` transaction, which is exactly what sets that same
   * `app.org_id` GUC for the duration of `tx` (SDD-007 "Documentos y flujo": keeps the counter's
   * `last_seq` from ever lagging behind an id a document actually used, regardless of ordering, without a
   * separate row lock — the unique `(project_id, kind)` constraint plus `GREATEST` makes this safe under
   * concurrent inserts for different kinds; same-kind inserts are already serialized by this project's
   * advisory lock). */
  private async bumpIdCounter(tx: PgDatabase, kind: DocumentKindValue, seq: number): Promise<void> {
    await seedIdCounterAtLeast(tx, this.projectId, kind, seq);
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

  /**
   * `EngineOps.updateDocument` (SDD-007; WO-139 → WO-250): a `collab`-origin document may have a working
   * copy a human is actively editing (`createFeatureRequest` appending to a Feedback's `informs`, or
   * `closeFeature` closing a Feature — both call this on a document that, in the SaaS product, is always
   * `collab`-origin, never `generated`), so the requested fields are split by `isServerManagedField`:
   * server-managed ones (`status`/`closed_at`/`closed_by` for `closeFeature`) go straight to
   * `published_raw` via `writeServerManagedCollabFields`, since SDD-008's own design keeps them out of the
   * Y.Doc entirely — there is nothing a rollback needs to protect there, unlike a genuinely human-editable
   * field (`informs`), which still can never be applied via a direct `UPDATE` of `published_raw`/a future
   * `working_state` (a change already broadcast to a live `Y.Doc` can't be undone if this transaction
   * later rolls back) and keeps going through `queuePendingEditablePatch`, unchanged since WO-139.
   */
  private async writeGeneratedFields(tx: PgDatabase, id: string, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    const row = await this.findDocumentRow(tx, id);
    if (row.origin !== 'collab') {
      if (row.publishedRaw === null) throw new Error(`document ${id} has no published content to update`);
      return this.writeGeneratedContent(tx, row, setFrontmatterFields(row.publishedRaw, fields));
    }

    const serverManagedFields: Record<string, FieldValue> = {};
    const editableFields: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (isServerManagedField(key, value)) serverManagedFields[key] = value;
      else editableFields[key] = value;
    }

    if (Object.keys(serverManagedFields).length === 0) return this.queuePendingEditablePatch(tx, row, editableFields);

    const written = await this.writeServerManagedCollabFields(tx, row, serverManagedFields);
    if (Object.keys(editableFields).length > 0) return this.queuePendingEditablePatch(tx, row, editableFields);
    return written;
  }

  /**
   * WO-250: writes a `collab`-origin document's server-managed fields (see `isServerManagedField`)
   * directly to `published_raw`, reusing the exact same `setFrontmatterFields`/`writeGeneratedContent`
   * path (`reason: 'engine_write'`) a `generated`-origin write already uses — this is what makes the
   * change visible to `scan()`/drift/graph/MCP the instant this transaction commits, with no dependency on
   * anyone ever opening this document's editor (the WO-250 bug: `closeFeature`'s status flip used to only
   * ever reach `pending_editable_patch`, invisible to all of those unless someone happened to open the
   * live editor). Queues the equivalent live-`Y.Doc` update in `pendingLiveDocSyncs` rather than applying
   * it immediately — `withTx` only flushes that queue once the surrounding Postgres transaction has
   * actually committed, since a change already broadcast to a live document can't be undone by a later
   * rollback (the very invariant WO-139 originally introduced `pending_editable_patch` to protect).
   */
  private async writeServerManagedCollabFields(tx: PgDatabase, row: DocumentRow, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    if (row.publishedRaw === null) throw new Error(`document ${row.docId} has no published content to update`);
    const parsed = await this.writeGeneratedContent(tx, row, setFrontmatterFields(row.publishedRaw, fields));
    this.pendingLiveDocSyncs.push({ documentId: row.id, fields });
    return parsed;
  }

  /**
   * WO-250: applies `fields` to document `documentId`'s live `Y.Doc` as a real, `system:engine`-attributed
   * transaction — same "open a direct connection, diff a scratch clone (carrying a fresh client id)
   * against the live document's current state vector, durably write the `doc_updates` row *before* the
   * diff ever reaches the live document and gets broadcast, only then `applyUpdate` the live document"
   * pattern as `../collab/restore.ts`/`../collab/accept-agent-proposal.ts` (their own module doc comments
   * explain why a direct connection has to do this itself: it never goes through the normal `beforeSync`
   * attribution hook). `Hocuspocus.openDirectConnection` loads the document on demand via
   * `../collab/persistence.ts`'s `onLoadDocument` regardless of whether a live session is already open for
   * it, so this reaches the document's true current state either way. A no-op (returns immediately) when
   * this `PgProjectEngine` was constructed without a `hocuspocus` instance.
   */
  private async applyServerManagedFieldsToLiveDoc(documentId: string, fields: Record<string, FieldValue>): Promise<void> {
    if (!this.hocuspocus) return;

    const documentName = formatDocumentName(this.projectId, documentId);
    const direct = await this.hocuspocus.openDirectConnection(documentName, {});
    try {
      const liveDocument = direct.document;
      if (!liveDocument) throw new Error(`direct connection to ${documentName} has no document`);

      const clientId = freshClientId();
      const before = Y.encodeStateVector(liveDocument);
      const scratch = createDocumentYDoc();
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(liveDocument));
      scratch.clientID = clientId;
      scratch.transact(() => {
        const fm = scratch.getMap<FrontmatterValue>(FRONTMATTER_ROOT);
        for (const [key, value] of Object.entries(fields)) {
          try {
            assertValidRoot(FRONTMATTER_ROOT, key, value);
          } catch (err) {
            // Matches `../collab/persistence.ts`'s own `applyPendingPatch`: a key/value this Y.Doc's
            // narrower `FrontmatterValue` can't represent must never block every other field in the same
            // write from reaching the live document.
            if (err instanceof InvalidDocumentRootError) continue;
            throw err;
          }
          fm.set(key, value as FrontmatterValue);
        }
      }, ENGINE_WRITE_ORIGIN);
      const update = Y.encodeStateAsUpdate(scratch, before);
      scratch.destroy();

      if (update.length === 0) return;

      const { structRanges, deleteRanges } = decodeUpdateRanges(update);
      await withTenantTx(this.pool, this.orgId, async (writeTx) => {
        await writeTx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${documentId}::text, ${DOC_UPDATES_LOCK_SALT}))`);
        const [latest] = await writeTx
          .select({ seq: schema.docUpdates.seq })
          .from(schema.docUpdates)
          .where(eq(schema.docUpdates.documentId, documentId))
          .orderBy(desc(schema.docUpdates.seq))
          .limit(1);
        const seq = (latest?.seq ?? 0) + 1;

        // No `doc_client_bindings` row, matching `../collab/accept-agent-proposal.ts`'s own note: bindings
        // only ever bind a *user's* client id to look up who's typing live — a `system:engine`-attributed
        // server transaction is never itself a live connection.
        await writeTx.insert(schema.docUpdates).values({
          orgId: this.orgId,
          documentId,
          seq,
          actorKind: 'system',
          userId: null,
          onBehalfOf: null,
          agentId: null,
          connectionId: null,
          update: Buffer.from(update),
          structRanges,
          deleteRanges,
        });
      });

      await direct.transact((doc) => Y.applyUpdate(doc, update, ENGINE_WRITE_ORIGIN));
    } finally {
      await direct.disconnect();
    }
  }

  /** Merges `fields` into `documents.pending_editable_patch` (a plain shallow merge: the latest write
   * for a given key always wins, matching `setFrontmatterFields`' own "last write wins" semantics)
   * without touching `published_raw`/versions/`workflow_state` at all — nothing about what's actually
   * shipped changes, so this deliberately does not mark the graph dirty either. Returns a `ParsedDoc`
   * parsed from the document's current (still-unpatched) content purely to satisfy `EngineOps`'
   * contract; every current caller of `ops.updateDocument` against a `collab`-origin document discards
   * the return value. */
  private async queuePendingEditablePatch(tx: PgDatabase, row: DocumentRow, fields: Record<string, FieldValue>): Promise<ParsedDoc> {
    const existingPatch = (row.pendingEditablePatch as Record<string, FieldValue> | null) ?? {};
    const mergedPatch = { ...existingPatch, ...fields };
    await tx.update(schema.documents).set({ pendingEditablePatch: mergedPatch, updatedAt: new Date() }).where(eq(schema.documents.id, row.id));

    const currentContent = row.publishedRaw ?? (await this.latestVersionContent(tx, row.id));
    if (currentContent === null) throw new Error(`document ${row.docId} has no content to reflect in the pending-patch return value`);
    return this.reparseOrThrow(row.sourcePath, currentContent);
  }

  private async latestVersionContent(tx: PgDatabase, documentId: string): Promise<string | null> {
    const [maxRow] = await tx
      .select({ maxVersionNo: sql<number>`coalesce(max(${schema.documentVersions.versionNo}), 0)` })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    if (!maxRow || maxRow.maxVersionNo === 0) return null;
    const [latest] = await tx
      .select({ renderedMarkdown: schema.documentVersions.renderedMarkdown })
      .from(schema.documentVersions)
      .where(and(eq(schema.documentVersions.documentId, documentId), eq(schema.documentVersions.versionNo, maxRow.maxVersionNo)));
    return latest?.renderedMarkdown ?? null;
  }

  /** `EngineOps.renameFrontmatterField`: only ever called by `migrate/docs.ts` (local-only, SDD-007),
   * never reached against a real `collab`-origin document in the SaaS product today — guarded anyway,
   * consistently with `writeGeneratedFields`, rather than silently mis-happening if that ever changes. */
  private async renameField(tx: PgDatabase, id: string, oldKey: string, newKey: string): Promise<ParsedDoc> {
    const row = await this.findDocumentRow(tx, id);
    if (row.origin === 'collab') throw new Error(`cannot rename a frontmatter field on ${id}: it has a working copy (SDD-008 will support this once collab exists)`);
    if (row.publishedRaw === null) throw new Error(`document ${id} has no published content to update`);
    return this.writeGeneratedContent(tx, row, renameFrontmatterKey(row.publishedRaw, oldKey, newKey));
  }

  /** `EngineOps.replaceDocument`: same immutable-id guarantee as `Engine.replaceDocument`, and the same
   * `collab`-origin guard as `writeGeneratedFields` (see its doc comment) — not reached by any current
   * domain function, guarded for the same reason as `renameField` above. */
  private async replace(tx: PgDatabase, id: string, content: string): Promise<ParsedDoc> {
    const row = await this.findDocumentRow(tx, id);
    if (row.origin === 'collab') throw new Error(`cannot replace ${id}'s content: it has a working copy (SDD-008 will support this once collab exists)`);
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

  /**
   * Publishes a human-authored (`origin: 'collab'`) document (SDD-007 "Documentos y flujo"; WO-137):
   * freezes a new `document_versions` row (`reason: 'published'`) from already-validated final content
   * (the caller runs `validateDocument` in `'publish'` mode *before* calling this — this method only
   * re-checks that `expectedVersionId` is still the actual latest version, a narrow data-integrity
   * guard against a concurrent publish/edit racing this one, under the same per-project advisory lock
   * every other write here uses), sets `workflow_state = 'published'`/`published_raw`/
   * `published_content_hash`/`published_version_id`, and marks the graph dirty — `withTx`'s own
   * post-commit step (WO-133) then projects it exactly like any other write.
   */
  async publishDocument(docId: string, input: { expectedVersionId: string; renderedMarkdown: string; frontmatter: Record<string, unknown>; publishedBy: string }): Promise<DocumentRow> {
    return this.withTx(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.documents)
        .where(and(eq(schema.documents.projectId, this.projectId), eq(schema.documents.docId, docId)));
      if (!row) throw new Error(`document ${docId} not found`);

      const [maxRow] = await tx
        .select({ maxVersionNo: sql<number>`coalesce(max(${schema.documentVersions.versionNo}), 0)` })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, row.id));
      const [latestVersion] = await tx
        .select()
        .from(schema.documentVersions)
        .where(and(eq(schema.documentVersions.documentId, row.id), eq(schema.documentVersions.versionNo, maxRow?.maxVersionNo ?? 0)));
      if (!latestVersion || latestVersion.id !== input.expectedVersionId) {
        throw new Error(`${docId} has a newer version than the one being published; reload and try again`);
      }

      const contentHash = sha256(input.renderedMarkdown);
      const [published] = await tx
        .insert(schema.documentVersions)
        .values({
          orgId: this.orgId,
          documentId: row.id,
          versionNo: (maxRow?.maxVersionNo ?? 0) + 1,
          reason: 'published',
          renderedMarkdown: input.renderedMarkdown,
          frontmatter: input.frontmatter,
          contentHash,
          contributors: [input.publishedBy],
          createdBy: input.publishedBy,
        })
        .returning();
      if (!published) throw new Error(`failed to insert published version for ${docId}`);

      const [updated] = await tx
        .update(schema.documents)
        .set({ workflowState: 'published', publishedRaw: input.renderedMarkdown, publishedContentHash: contentHash, publishedVersionId: published.id, updatedAt: new Date() })
        .where(eq(schema.documents.id, row.id))
        .returning();
      if (!updated) throw new Error(`failed to update document ${docId} after publish`);

      await this.markGraphDirty(tx);
      return updated;
    });
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
    // The `commits` table (SDD-007) has no parent-chain column; the WO-231 ancestry check consults
    // `CodeReportRequest.commits[].parents` directly at report time and never round-trips through here.
    return { sha: row.sha, parents: [], author: row.author, date: row.date.toISOString(), subject: row.subject, refs: row.refs, files: row.files };
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
      .map((row): CommitInfo => ({ sha: row.sha, parents: [], author: row.author, date: row.date.toISOString(), subject: row.subject, refs: row.refs, files: row.files }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * `governed` (WO-334, SDD-012): loaded from `project_code_refs` — the per-blueprint replacement a
   * baseline code report writes (WO-333) — grouped by `blueprint_id`, excluding (a) any blueprint id in
   * `excludeBlueprintIds` (`doRefreshOrInspect`'s own `staleBlueprintIds`, from `reconcileByHash`: a
   * blueprint whose `impacts_paths` changed since the report that produced these refs must never be
   * reconciled against them) and (b) any row whose `hash_algo_version` no longer matches
   * `this.hashAlgoVersion` — the same "never trust a stale signature" reasoning `awaiting_ci_report`
   * already applies one level up, at the `impacts_paths`-hash level. A blueprint with zero surviving
   * rows is simply absent from the returned map (never an empty array), matching `detectDrift`'s own
   * "not present" vs "present but empty" distinction used by `reconcileBaseline`.
   */
  private async loadGoverned(tx: PgDatabase, excludeBlueprintIds: ReadonlySet<string>): Promise<Map<string, CodeRefState[]>> {
    const rows = await tx.select().from(schema.projectCodeRefs).where(eq(schema.projectCodeRefs.projectId, this.projectId));
    const governed = new Map<string, CodeRefState[]>();
    for (const row of rows) {
      if (excludeBlueprintIds.has(row.blueprintId) || row.hashAlgoVersion !== this.hashAlgoVersion) continue;
      const state: CodeRefState = { key: row.refKey, path: row.path, symbol: row.symbol, hash: row.hash };
      const existing = governed.get(row.blueprintId);
      if (existing) existing.push(state);
      else governed.set(row.blueprintId, [state]);
    }
    return governed;
  }

  /** `governWarnings`/`dirty` stay empty (SDD-007): a SaaS project has no local working tree to compute
   * `dirty` from, and `governWarnings` (a report's `governed_warnings[]`, WO-333) is a persisted, purely
   * informational list surfaced separately rather than fed back through `detectDrift`'s own
   * `impacts_warning` issue path. `excludeBlueprintIds` defaults to none for callers without a
   * reconciliation context of their own (`acknowledge()`, `buildSnapshot()`) — see {@link loadGoverned}.
   */
  private async buildDriftInput(tx: PgDatabase, scan: ScanResult, excludeBlueprintIds: ReadonlySet<string> = new Set()): Promise<DriftInput> {
    const [baseline, commits, governed] = await Promise.all([this.loadBaseline(tx), this.loadBaselineCommits(tx), this.loadGoverned(tx, excludeBlueprintIds)]);
    return {
      docs: scan.docs,
      governed,
      governWarnings: [],
      baseline,
      commits,
      dirty: new Set(),
      lifecycle: this.settings.lifecycle,
    };
  }

  private async loadImpactsHashes(tx: PgDatabase): Promise<Record<string, string>> {
    const [row] = await tx.select({ impactsHashes: schema.projectCodeState.impactsHashes }).from(schema.projectCodeState).where(eq(schema.projectCodeState.projectId, this.projectId));
    return (row?.impactsHashes as Record<string, string> | null) ?? {};
  }

  /**
   * SDD-007 "PgProjectEngine" reconciliation-by-hash (WO-134): `project_code_state.impacts_hashes`
   * records, per blueprint, the hash of its `impacts_paths` as of the last CI-verified code report that
   * covered it (SDD-010 populates this — until then every blueprint is simply never reconciled, which
   * is the honest, safe default). A blueprint whose *current* `impacts_paths` still hashes to that
   * recorded value is "reconcilable" (nothing to warn about, even though there is not yet any live
   * per-ref code state to actually reconcile against — see `buildDriftInput`'s doc comment); one whose
   * hash changed (or that was never reported at all) gets a non-blocking `awaiting_ci_report` issue and
   * must never have its stored `baseline.governs` entry touched by this refresh.
   */
  private reconcileByHash(scan: ScanResult, reportedHashes: Record<string, string>): { warnings: DriftIssue[]; staleBlueprintIds: string[] } {
    const warnings: DriftIssue[] = [];
    const staleBlueprintIds: string[] = [];
    for (const doc of scan.docs) {
      if (doc.node.label !== 'Blueprint') continue;
      const currentHash = impactsPathsHash(doc.impactsPaths);
      if (reportedHashes[doc.node.id] === currentHash) continue;
      staleBlueprintIds.push(doc.node.id);
      warnings.push({
        kind: 'awaiting_ci_report',
        severity: 'warning',
        nodeId: doc.node.id,
        message: `${doc.node.id}'s impacts_paths changed since the last CI-verified code report (or none exists yet); its code governance baseline is left untouched until a new report arrives`,
      });
    }
    return { warnings, staleBlueprintIds };
  }

  /** Restores `next`'s `governs` entry for every blueprint `reconcileByHash` flagged as stale, from
   * whatever `previous` (the baseline this refresh started from) already had — `buildRefreshReport`
   * never writes those keys itself (they are absent from `governed`, per `buildDriftInput`'s doc
   * comment), so without this a refresh would silently drop a blueprint's recorded code state the
   * moment its `impacts_paths` changed, instead of just leaving it alone until the next CI report. */
  private preserveStaleGoverns(previous: Baseline, next: Baseline, staleBlueprintIds: string[]): Baseline {
    if (staleBlueprintIds.length === 0) return next;
    const governs = { ...next.governs };
    for (const id of staleBlueprintIds) {
      if (previous.governs[id] !== undefined) governs[id] = previous.governs[id];
    }
    return { ...next, governs };
  }

  private async doRefreshOrInspect(tx: PgDatabase, persist: boolean): Promise<RefreshReport> {
    const scan = await loadScanState(tx, this.projectId);
    // WO-334: the reconciled-by-hash verdict must exist *before* buildDriftInput loads `governed`, so a
    // stale blueprint's project_code_refs rows are excluded from this refresh entirely rather than fed
    // into detectDrift only to have their resulting baseline entry overwritten afterward.
    const reportedHashes = await this.loadImpactsHashes(tx);
    const { warnings, staleBlueprintIds } = this.reconcileByHash(scan, reportedHashes);
    const input = await this.buildDriftInput(tx, scan, new Set(staleBlueprintIds));
    const built = buildRefreshReport(input);
    const issues: DriftIssue[] = [...built.issues, ...warnings];

    if (!persist) {
      return {
        documents: scan.docs.length,
        errors: scan.errors,
        issues,
        governed: built.governed,
        workOrderUpdates: built.workOrderUpdates,
        baselineWritten: false,
        hasBlockingIssues: scan.errors.length > 0 || issues.some((i) => i.severity === 'error'),
      };
    }

    const { applied, failures } = await this.applyStatusUpdates(tx, built.workOrderUpdates);
    const allIssues: DriftIssue[] = [...issues, ...failures];
    // Mirrors `Engine.doRefresh`: a document that temporarily fails to parse must not be silently
    // pruned from the baseline (it would come back as "new" — drift silently accepted).
    const baselineWritten = scan.errors.length === 0;
    if (baselineWritten) await this.saveBaseline(tx, this.preserveStaleGoverns(input.baseline, built.baseline, staleBlueprintIds));

    return {
      documents: scan.docs.length,
      errors: scan.errors,
      issues: allIssues,
      governed: built.governed,
      workOrderUpdates: applied,
      baselineWritten,
      hasBlockingIssues: scan.errors.length > 0 || allIssues.some((i) => i.severity === 'error'),
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
