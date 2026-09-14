/**
 * `POST /api/v1/projects/:graphProjectId/policy-docs` (SDD-010 "Sync de developers y drift"/"check
 * commits --range remoto", WO-183): the documents as they existed at each requested sha's own recorded
 * `first_seen_at` (`commits`, WO-182) — never at the date its own `git log` metadata claims, which a
 * developer controls and could backdate, and never "as of now" for a sha this server has already seen
 * reported. A sha the server has never seen at all is evaluated "as of now" (the server's own clock).
 * Scope `governance:read`.
 *
 * A single request handles a whole batch of shas without turning into one query per sha (SDD-010: "en
 * un único request"): every sha's evaluation instant is resolved with one `commits` lookup
 * (`WHERE sha = ANY(...)`), then every *distinct* instant needed is joined against
 * `document_versions` in one more query — `WITH ts(idx, evaluated_at) AS (VALUES ...) ... JOIN LATERAL`
 * picks, per document per instant, the latest version whose `created_at` doesn't exceed it. A document
 * with no version yet as of some instant simply doesn't appear in that instant's document list — this
 * is a real point-in-time reconstruction, not a snapshot of "currently published" content.
 */
import { governanceDocumentSchema, policyDocsRequestSchema, type GovernanceDocumentDto } from '@prdm/contracts';
import { resolveProjectByGraphProjectId, schema, withTenantTx } from '@prdm/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { NotFoundError, ValidationError } from '../errors.js';

export interface RegisterPolicyDocsRoutesOptions {
  pool: Pool;
}

interface PolicyDocsRouteParams {
  graphProjectId: string;
}

interface PolicyDocsAtRow extends Record<string, unknown> {
  idx: number;
  docId: string;
  sourcePath: string;
  content: string;
}

/** Loads, for each of `instants` (by array index), the latest version of every document in
 * `projectId` whose `created_at <= instants[idx]` — one query regardless of how many distinct instants
 * are requested. */
async function loadDocumentsAtInstants(pool: Pool, orgId: string, projectId: string, instants: readonly Date[]): Promise<Map<number, GovernanceDocumentDto[]>> {
  const result = new Map<number, GovernanceDocumentDto[]>();
  if (instants.length === 0) return result;

  await withTenantTx(pool, orgId, async (tx) => {
    const valuesList = sql.join(
      instants.map((instant, idx) => sql`(${idx}::int, ${instant}::timestamptz)`),
      sql`, `,
    );
    const query = sql`
      WITH ts(idx, evaluated_at) AS (VALUES ${valuesList})
      SELECT ts.idx AS "idx", d.doc_id AS "docId", d.source_path AS "sourcePath", dv.rendered_markdown AS "content"
      FROM ts
      CROSS JOIN "documents" d
      JOIN LATERAL (
        SELECT dv2.rendered_markdown
        FROM "document_versions" dv2
        WHERE dv2.document_id = d.id AND dv2.created_at <= ts.evaluated_at
        ORDER BY dv2.created_at DESC
        LIMIT 1
      ) dv ON true
      WHERE d.project_id = ${projectId}
    `;
    const rows = (await tx.execute<PolicyDocsAtRow>(query)).rows;
    for (const row of rows) {
      const doc = governanceDocumentSchema.parse({ id: row.docId, sourcePath: row.sourcePath, content: row.content });
      const list = result.get(row.idx) ?? [];
      list.push(doc);
      result.set(row.idx, list);
    }
  });
  return result;
}

export function registerPolicyDocsRoutes(app: FastifyInstance, opts: RegisterPolicyDocsRoutesOptions): void {
  const { pool } = opts;

  app.post<{ Params: PolicyDocsRouteParams }>(
    '/api/v1/projects/:graphProjectId/policy-docs',
    { config: { access: { kind: 'bearer', scope: 'governance:read' } } },
    async (req) => {
      const token = req.token!;
      const resolved = await resolveProjectByGraphProjectId(pool, req.params.graphProjectId);
      if (!resolved || resolved.orgId !== token.orgId) throw new NotFoundError();
      if (token.projectIds && !token.projectIds.includes(resolved.projectId)) throw new NotFoundError();

      const parsedBody = policyDocsRequestSchema.safeParse(req.body);
      if (!parsedBody.success) throw new ValidationError('invalid body');
      const { shas } = parsedBody.data;

      const firstSeenRows = await withTenantTx(pool, resolved.orgId, (tx) =>
        tx
          .select({ sha: schema.commits.sha, firstSeenAt: schema.commits.firstSeenAt })
          .from(schema.commits)
          .where(and(eq(schema.commits.projectId, resolved.projectId), inArray(schema.commits.sha, shas))),
      );
      const firstSeenBySha = new Map(firstSeenRows.map((row) => [row.sha, row.firstSeenAt]));
      const now = req.server.clock();

      // De-duplicated instants, indexed, so `loadDocumentsAtInstants` runs exactly once regardless of
      // how many shas share the same instant (every never-reported sha shares "now").
      const instantKeyOf = (d: Date): string => d.toISOString();
      const instantsByKey = new Map<string, Date>();
      const evaluatedAtBySha = new Map<string, Date>();
      for (const sha of shas) {
        const evaluatedAt = firstSeenBySha.get(sha) ?? now;
        evaluatedAtBySha.set(sha, evaluatedAt);
        instantsByKey.set(instantKeyOf(evaluatedAt), evaluatedAt);
      }
      const instants = [...instantsByKey.values()];
      const indexByKey = new Map(instants.map((instant, idx) => [instantKeyOf(instant), idx]));

      const documentsByIndex = await loadDocumentsAtInstants(pool, resolved.orgId, resolved.projectId, instants);

      const results = shas.map((sha) => {
        const evaluatedAt = evaluatedAtBySha.get(sha)!;
        const idx = indexByKey.get(instantKeyOf(evaluatedAt))!;
        return { sha, evaluatedAt: evaluatedAt.toISOString(), documents: documentsByIndex.get(idx) ?? [] };
      });

      return { results };
    },
  );
}
