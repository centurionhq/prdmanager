/**
 * `POST /api/v1/projects/:graphProjectId/code-reports` (SDD-010 "Sync de developers y drift",
 * WO-180): the only way drift ever gets computed from a report the SaaS never reads a repo to produce
 * itself. Scope `reports:write`. Idempotent by `(project_id, token_id, Idempotency-Key)` — see
 * `@prdm/db`'s `recordCodeReport`/`./schema/code-reports.ts` for why the whole result travels inside a
 * single `INSERT ... ON CONFLICT DO NOTHING` rather than a two-phase reserve-then-update.
 *
 * Every report defaults to **preview** (WO-181 replaces the hardcoded `mode` below with the real
 * baseline gate: CI scope + verified OIDC + non-regressing head + matching `hash_algo_version`) — a
 * pure `detectDrift` against the currently stored baseline, via the `codeReportToDriftInput` adapter;
 * nothing here ever calls `PgProjectEngine.refresh()` or writes `project_baselines`/`commits`.
 *
 * A stale `docs_graph_version` (the client computed `governed[]` against an older `graph_version` than
 * the project's current one) is rejected with `409 docs_outdated` *before* touching the idempotency
 * ledger at all — so a client that refetches and retries (SDD-010: "refetchea y reintenta una vez")
 * never collides with its own aborted first attempt, whether it reuses the same `Idempotency-Key` or
 * not.
 */
import { randomUUID } from 'node:crypto';
import { codeReportRequestSchema, MAX_CODE_REPORT_BODY_BYTES, type CodeReportResponse } from '@prdm/contracts';
import { detectDrift, emptyBaseline, scanContents, sha256, type Baseline } from '@prdm/core';
import { createTenantDb, recordCodeReport, resolveProjectByGraphProjectId, schema, withTenantTx } from '@prdm/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { codeReportToDriftInput } from '../engine/code-report-adapter.js';
import { NotFoundError, ValidationError } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by this route's own scoped JSON content-type parser below — the exact raw bytes
     * `body_sha256` hashes, never a re-serialization of the parsed object (which could hash two
     * semantically-identical bodies differently depending on key order). */
    rawBody?: string;
  }
}

export interface RegisterCodeReportRoutesOptions {
  pool: Pool;
}

interface CodeReportRouteParams {
  graphProjectId: string;
}

async function loadBaseline(pool: Pool, orgId: string, projectId: string): Promise<Baseline> {
  return withTenantTx(pool, orgId, async (tx) => {
    const [row] = await tx.select({ baseline: schema.projectBaselines.baseline }).from(schema.projectBaselines).where(eq(schema.projectBaselines.projectId, projectId));
    return (row?.baseline as Baseline | undefined) ?? emptyBaseline();
  });
}

export function registerCodeReportRoutes(app: FastifyInstance, opts: RegisterCodeReportRoutesOptions): void {
  const { pool } = opts;

  // Scoped registration (not the top-level `app`): the raw-body-capturing content-type parser below
  // must only ever apply to this one route, never to every other `application/json` route on the
  // server — a Fastify child instance is the idiomatic way to scope a content-type parser override.
  void app.register(async (scoped) => {
    scoped.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
      req.rawBody = body;
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    scoped.post<{ Params: CodeReportRouteParams }>(
      '/api/v1/projects/:graphProjectId/code-reports',
      { config: { access: { kind: 'bearer', scope: 'reports:write' } }, bodyLimit: MAX_CODE_REPORT_BODY_BYTES },
      async (req, reply) => {
        const token = req.token!;
        const resolved = await resolveProjectByGraphProjectId(pool, req.params.graphProjectId);
        if (!resolved || resolved.orgId !== token.orgId) throw new NotFoundError();
        if (token.projectIds && !token.projectIds.includes(resolved.projectId)) throw new NotFoundError();

        const idempotencyKeyHeader = req.headers['idempotency-key'];
        if (typeof idempotencyKeyHeader !== 'string' || idempotencyKeyHeader.length === 0) {
          throw new ValidationError('missing Idempotency-Key header');
        }

        const parsedBody = codeReportRequestSchema.safeParse(req.body);
        if (!parsedBody.success) throw new ValidationError('invalid code report body');
        const report = parsedBody.data;

        const scope = createTenantDb(pool).forOrg(resolved.orgId).forProject(resolved.projectId);
        const project = await scope.get();
        if (!project) throw new NotFoundError();
        if (report.docs_graph_version !== project.graphVersion.toString()) {
          return reply.code(409).send({ error: 'docs_outdated', currentGraphVersion: project.graphVersion.toString() });
        }

        const rawBody = req.rawBody ?? JSON.stringify(req.body);
        const bodySha256 = sha256(rawBody);

        const published = await scope.documents.listPublished();
        const scanned = scanContents(published.map((doc) => ({ path: doc.sourcePath, content: doc.publishedRaw })));
        const baseline = await loadBaseline(pool, resolved.orgId, resolved.projectId);

        // WO-180 scope: always preview (a pure computation, no side effects) — WO-181 adds the real
        // baseline gate (CI scope + verified OIDC + non-regressing head + hash_algo_version match)
        // and, only when it passes, the actual `PgProjectEngine.refresh()`/`commits` write.
        const mode = 'preview' as const;
        const input = codeReportToDriftInput(report, scanned.docs, baseline);
        const drift = detectDrift(input);

        const result: CodeReportResponse = {
          mode,
          reportId: randomUUID(),
          headSha: report.head_sha,
          issues: drift.issues,
          hasBlockingIssues: drift.issues.some((issue) => issue.severity === 'error'),
        };

        const outcome = await recordCodeReport(pool, {
          projectId: resolved.projectId,
          orgId: resolved.orgId,
          tokenId: token.tokenId,
          idempotencyKey: idempotencyKeyHeader,
          bodySha256,
          mode,
          headSha: report.head_sha,
          result,
        });

        if (outcome.kind === 'mismatch') {
          return reply.code(422).send({ error: 'idempotency_mismatch' });
        }
        return outcome.record.result;
      },
    );
  });
}
