/**
 * Minimal `documents` row fixture for collab tests (SDD-008) — bypasses RLS via `pg.ownerPool` exactly
 * like `@prdm/testkit`'s own `createProjectFixture`, since `packages/testkit` itself is out of scope for
 * this SDD's `impacts_paths` (documents didn't exist yet when that package was written).
 */
import { randomUUID } from 'node:crypto';
import type { PgTestDb } from '@prdm/testkit';

export interface DocumentFixtureOverrides {
  orgId: string;
  projectId: string;
  origin?: 'collab' | 'generated' | 'import';
  workflowState?: 'draft' | 'in_review' | 'published' | 'archived';
  /** Real `KIND-NNN` doc_id when a test needs the document to pass schema validation (WO-396). */
  docId?: string;
}

export async function insertCollabDocumentFixture(pg: PgTestDb, overrides: DocumentFixtureOverrides): Promise<string> {
  const id = randomUUID();
  await pg.ownerPool.query(
    `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
     VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', $5, $6)`,
    [id, overrides.orgId, overrides.projectId, overrides.docId ?? `PRD-${id.slice(0, 8)}`, overrides.origin ?? 'collab', overrides.workflowState ?? 'draft'],
  );
  return id;
}
