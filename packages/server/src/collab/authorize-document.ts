/**
 * Shared per-document authorization decision (SDD-008 §"Servidor de tiempo real"): given an already
 * `resolve_document`-resolved `(orgId, projectId, documentId)` and a `userId`, decides whether the
 * caller may see the document at all and, if so, whether their connection must be read-only. Used both
 * by `onAuthenticate` (`./authenticate.js`, once per new connection) and the periodic revalidation
 * extension (`./revalidate.js`, every 60s per already-established connection) so the two can never
 * silently disagree about what "still allowed" means.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { can } from '@prdm/contracts';
import { schema, withTenantTx } from '@prdm/db';
import { resolveCollabPermissionSubject } from './resolve-subject.js';

export interface CollabAuthorizationParams {
  orgId: string;
  projectId: string;
  documentId: string;
  userId: string;
}

export interface CollabAuthorizationResult {
  readOnly: boolean;
}

/** `null` means "not allowed at all" (no `view` permission, or the document row itself can't be found
 * inside this org/project) — the caller maps that to whatever rejection its own hook produces. */
export async function authorizeCollabDocument(pool: Pool, params: CollabAuthorizationParams): Promise<CollabAuthorizationResult | null> {
  const subject = await resolveCollabPermissionSubject(pool, params.orgId, params.projectId, params.userId);
  if (!subject || !can(subject, 'view')) return null;

  const documentRow = await withTenantTx(pool, params.orgId, async (tx) => {
    const [row] = await tx
      .select({ origin: schema.documents.origin, workflowState: schema.documents.workflowState })
      .from(schema.documents)
      .where(eq(schema.documents.id, params.documentId));
    return row ?? null;
  });
  if (!documentRow) return null;

  const forcedReadOnly = documentRow.origin === 'generated' || documentRow.workflowState === 'archived';
  return { readOnly: forcedReadOnly || !can(subject, 'edit_document') };
}
