/**
 * Live validation (SDD-008 §"Validación en vivo, versiones y comentarios"): after every collab store,
 * runs `@prdm/core`'s `validateDocument` in `'edit'` mode over the just-stored `Y.Doc`'s projection,
 * persists the outcome to `documents.last_validation`, and tells connected clients via a stateless
 * broadcast. Reuses the exact same `onStoreDocument` hook name `./blame.js`'s stale-broadcast extension
 * does — Hocuspocus awaits every extension's hook of a given name in array order, so both simply run in
 * whatever order `register-collab-route.ts` lists them, independently of each other.
 *
 * `validateDocument`'s `scan` (every published document) only changes when a project's `graph_version`
 * bumps (SDD-007's outbox projection), so it's cached per project id and only recomputed once that
 * number moves — never per keystroke/store, which would otherwise mean an O(published docs) rescan on
 * every single collab flush.
 *
 * `scan.ids` is the exception (SDD-015): it holds every doc_id in any workflow state, and creating a draft
 * never bumps `graph_version`, so the cached ids would miss a just-created document and report a false
 * `stale_base`. They're re-read on every store with a single-column query and merged over the cached ids
 * (which keep the synthetic `id_counters` entries `PgProjectEngine.scan()` adds).
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type * as Y from 'yjs';
import { validateDocument, type DraftKind, type GrandfatheredDoc, type Neo4jGraphDatabase, type ScanResult } from '@prdm/core';
import { projectDoc } from '@prdm/collab';
import { createTenantDb, resolveDocumentById, schema, withTenantTx } from '@prdm/db';
import { buildProjectSettings } from '../engine/pg-project-settings.js';
import { resolvePgProjectEngine } from '../engine/resolve-pg-project-engine.js';
import { parseDocumentName } from './document-name.js';

export interface LiveValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  field?: string;
  message: string;
}

/** Matches just the slice of `@hocuspocus/server`'s `Document`/`onStoreDocumentPayload` this extension
 * needs (same structural-typing reasoning as `./persistence.js`/`./blame.js`). */
export interface LiveValidationExtension {
  extensionName: string;
  onStoreDocument(data: { documentName: string; document: Y.Doc & { broadcastStateless(payload: string): void } }): Promise<void>;
}

export interface LiveValidationDeps {
  pool: Pool;
  neo4j: Neo4jGraphDatabase;
}

interface ScanCacheEntry {
  graphVersion: bigint;
  scan: ScanResult;
  grandfathered: readonly GrandfatheredDoc[];
}

function toLiveValidationIssue(issue: { severity: 'error' | 'warning'; code: string; field?: string; message: string }): LiveValidationIssue {
  return issue.field === undefined
    ? { severity: issue.severity, code: issue.code, message: issue.message }
    : { severity: issue.severity, code: issue.code, field: issue.field, message: issue.message };
}

export function createLiveValidationExtension(deps: LiveValidationDeps): LiveValidationExtension {
  const { pool, neo4j } = deps;
  const scanCache = new Map<string, ScanCacheEntry>();

  return {
    extensionName: 'prdm-collab-live-validation',

    async onStoreDocument({ documentName, document }) {
      const parsed = parseDocumentName(documentName);
      if (!parsed) return;
      const resolved = await resolveDocumentById(pool, parsed.documentId);
      if (!resolved) return;

      const tenantDb = createTenantDb(pool).forOrg(resolved.orgId);
      const project = await tenantDb.projects.findById(resolved.projectId);
      if (!project) return;

      let cached = scanCache.get(project.id);
      if (!cached || cached.graphVersion !== project.graphVersion) {
        const engine = resolvePgProjectEngine(pool, neo4j, resolved.orgId, project);
        const scan = await engine.scan();
        const settings = buildProjectSettings(project);
        cached = { graphVersion: project.graphVersion, scan, grandfathered: settings.lifecycle.grandfathered };
        scanCache.set(project.id, cached);
      }

      const { documentRow, projectDocIds } = await withTenantTx(pool, resolved.orgId, async (tx) => {
        const [row] = await tx.select({ docId: schema.documents.docId, kind: schema.documents.kind }).from(schema.documents).where(eq(schema.documents.id, parsed.documentId));
        const idRows = await tx.select({ docId: schema.documents.docId }).from(schema.documents).where(eq(schema.documents.projectId, project.id));
        return { documentRow: row ?? null, projectDocIds: idRows.map((r) => r.docId) };
      });
      if (!documentRow) return;
      const scan: ScanResult = { ...cached.scan, ids: [...new Set([...cached.scan.ids, ...projectDocIds])] };

      const projection = projectDoc(document);
      const { id: _id, type: _type, title: _title, ...fields } = projection.fields;

      const outcome = validateDocument(
        { kind: documentRow.kind as DraftKind, title: projection.title, fields, body: projection.body, id: documentRow.docId, mode: 'edit' },
        { scan, grandfathered: cached.grandfathered },
      );
      const issues = outcome.issues.map(toLiveValidationIssue);

      await withTenantTx(pool, resolved.orgId, async (tx) => {
        await tx.update(schema.documents).set({ lastValidation: issues }).where(eq(schema.documents.id, parsed.documentId));
      });

      document.broadcastStateless(JSON.stringify({ type: 'validation:updated', issues }));
    },
  };
}
