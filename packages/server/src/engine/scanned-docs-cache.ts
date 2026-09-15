/**
 * Memoizes `code-reports.ts`'s scan of every currently published document, keyed by `projects.graph_version`
 * (performance review of WO-180/SDD-010, WO-261): `listPublished()` + `scanContents()` previously reran in
 * full on every single report — baseline or preview alike — even when nothing published had changed since
 * the last one. `governance.ts`'s own ETag already treats an unchanged `graph_version` as proof nothing
 * published changed (`PgProjectEngine`'s `markGraphDirty` is the only thing that ever advances it); this
 * cache trusts that exact same signal, purely as a performance optimization — correctness never depended on
 * it, since a report a request behind on `graph_version` is already rejected with `409 docs_outdated`
 * *before* this cache is ever consulted.
 *
 * Same one-entry-per-key, invalidate-on-mismatch shape as `../collab/blame.ts`'s `BlameCache`, keyed by
 * `projectId` instead of `documentId` and by `graph_version` instead of `doc_updates.seq`. The loader is
 * injectable (defaults to the real {@link loadAndScanPublishedDocs}) purely so a test can count how many
 * times it actually runs against a real Postgres, without mocking the database itself.
 */
import { scanContents, type ParsedDoc } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import type { Pool } from 'pg';

export type ScannedDocsLoader = (pool: Pool, orgId: string, projectId: string) => Promise<ParsedDoc[]>;

export async function loadAndScanPublishedDocs(pool: Pool, orgId: string, projectId: string): Promise<ParsedDoc[]> {
  const scope = createTenantDb(pool).forOrg(orgId).forProject(projectId);
  const published = await scope.documents.listPublished();
  return scanContents(published.map((doc) => ({ path: doc.sourcePath, content: doc.publishedRaw }))).docs;
}

export interface ScannedDocsCache {
  /** Recomputes only when `graphVersion` has moved since the last call for this `projectId`. */
  get(pool: Pool, orgId: string, projectId: string, graphVersion: bigint): Promise<ParsedDoc[]>;
}

export function createScannedDocsCache(loader: ScannedDocsLoader = loadAndScanPublishedDocs): ScannedDocsCache {
  const cache = new Map<string, { graphVersion: bigint; docs: ParsedDoc[] }>();

  return {
    async get(pool, orgId, projectId, graphVersion) {
      const cached = cache.get(projectId);
      if (cached && cached.graphVersion === graphVersion) return cached.docs;

      const docs = await loader(pool, orgId, projectId);
      cache.set(projectId, { graphVersion, docs });
      return docs;
    },
  };
}
