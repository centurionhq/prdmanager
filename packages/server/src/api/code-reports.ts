/**
 * `POST /api/v1/projects/:graphProjectId/code-reports` (SDD-010 "Sync de developers y drift",
 * WO-180/WO-181): the only way drift ever gets computed from a report the SaaS never reads a repo to
 * produce itself. Scope `reports:write`. Idempotent by `(project_id, token_id, Idempotency-Key)` — see
 * `@prdm/db`'s `recordCodeReport`/`./schema/code-reports.ts` for why the whole result travels inside a
 * single `INSERT ... ON CONFLICT DO NOTHING` rather than a two-phase reserve-then-update.
 *
 * Mode is decided by `../engine/baseline-gate.js`'s `evaluateBaselineGate` (WO-181): almost every
 * ineligibility reason falls silently to **preview** (a pure `detectDrift`, via the
 * `codeReportToDriftInput` adapter, against the currently stored baseline — no baseline/WO/graph writes
 * at all); only a `head_sha` regression without an audited admin override is a loud, distinct `409
 * force_push_requires_admin_override`. Every report, preview or baseline, upserts its `commits[]` into
 * the shared ledger (WO-182) with `trust` set to its own `mode` — never from anything the request body
 * claims — so WO-183's policy-docs endpoint can evaluate policy at a commit's `first_seen_at` even
 * before it's ever part of an official baseline. Only a **baseline** report additionally advances
 * `project_code_state.latest_baseline_head_sha`/`impacts_hashes` and runs `PgProjectEngine.refresh()` —
 * official drift, WO updates, graph projection.
 *
 * A stale `docs_graph_version` (the client computed `governed[]` against an older `graph_version` than
 * the project's current one) is rejected with `409 docs_outdated` *before* touching the idempotency
 * ledger at all — so a client that refetches and retries (SDD-010: "refetchea y reintenta una vez")
 * never collides with its own aborted first attempt, whether it reuses the same `Idempotency-Key` or
 * not.
 *
 * WO-233: the idempotency ledger is *read* (never written) as the very first thing this handler does —
 * a same-key-different-body request is now a `422` before any side effect runs at all, and a same-key-
 * same-body retry replays the stored result without redoing `upsertReportedCommits`/`recordBaselineHead`/
 * `PgProjectEngine.refresh()`. `recordBaselineHead`'s own read-modify-write of `impacts_hashes` takes
 * `PgProjectEngine`'s write-lock advisory lock (see `@prdm/db`'s `project-code-state-repository.ts`) so
 * two distinct, genuinely concurrent baseline reports for this project can never interleave and lose one
 * side's contribution.
 */
import { randomUUID } from 'node:crypto';
import { codeReportRequestSchema, GITHUB_OIDC_TOKEN_HEADER, MAX_CODE_REPORT_BODY_BYTES, projectSettingsSchema, type CodeReportResponse } from '@prdm/contracts';
import { detectDrift, emptyBaseline, scanContents, sha256, type Baseline, type Neo4jGraphDatabase } from '@prdm/core';
import {
  consumeForcePushOverride,
  createTenantDb,
  findCodeReportByIdempotencyKey,
  getProjectCodeState,
  recordBaselineHead,
  recordCodeReport,
  resolveProjectByGraphProjectId,
  schema,
  upsertReportedCommits,
  withTenantTx,
} from '@prdm/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { codeReportToDriftInput } from '../engine/code-report-adapter.js';
import { evaluateBaselineGate } from '../engine/baseline-gate.js';
import { requireNeo4j, resolvePgProjectEngine } from '../engine/resolve-pg-project-engine.js';
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
  neo4j?: Neo4jGraphDatabase;
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
  const { pool, neo4j } = opts;

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

        // WO-233: checked *before* any side effect (upsertReportedCommits/recordBaselineHead/
        // engine.refresh() below) — a same-key-different-body violation now short-circuits immediately
        // instead of only failing at the very end after wastefully repeating every side effect, and a
        // legitimate sequential retry (the common case: a client retrying after a lost response) never
        // redoes a baseline write or graph refresh at all. This alone can't fully close a genuinely
        // concurrent front-running race on a brand-new key — `recordCodeReport`'s own unique-index
        // INSERT below still does that, unchanged.
        const rawBodyForIdempotency = req.rawBody ?? JSON.stringify(req.body);
        const bodySha256ForIdempotency = sha256(rawBodyForIdempotency);
        const existingReport = await findCodeReportByIdempotencyKey(pool, {
          projectId: resolved.projectId,
          orgId: resolved.orgId,
          tokenId: token.tokenId,
          idempotencyKey: idempotencyKeyHeader,
        });
        if (existingReport) {
          if (existingReport.bodySha256 !== bodySha256ForIdempotency) {
            return reply.code(422).send({ error: 'idempotency_mismatch' });
          }
          return existingReport.result;
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

        const settings = projectSettingsSchema.parse(project.settings);
        const codeState = await getProjectCodeState(pool, resolved.orgId, resolved.projectId);
        const oidcTokenHeader = req.headers[GITHUB_OIDC_TOKEN_HEADER];

        const gate = await evaluateBaselineGate({
          token: { kind: token.kind, scopes: token.scopes },
          oidcToken: typeof oidcTokenHeader === 'string' ? oidcTokenHeader : undefined,
          settings,
          report,
          registeredBaselineHeadSha: codeState?.latestBaselineHeadSha ?? null,
          deps: {
            githubOidcJwks: req.server.githubOidcJwks,
            oidcJtiStore: req.server.oidcJtiStore,
            now: req.server.clock,
            publicUrl: req.server.env.publicUrl,
            consumeForcePushOverride: (headSha) => consumeForcePushOverride(pool, resolved.orgId, resolved.projectId, headSha),
          },
        });

        if (gate.mode === 'rejected') {
          return reply.code(409).send({ error: gate.code });
        }
        const mode = gate.mode;

        const published = await scope.documents.listPublished();
        const scanned = scanContents(published.map((doc) => ({ path: doc.sourcePath, content: doc.publishedRaw })));
        const baseline = await loadBaseline(pool, resolved.orgId, resolved.projectId);

        const input = codeReportToDriftInput(report, scanned.docs, baseline);
        const drift = detectDrift(input);

        const result: CodeReportResponse = {
          mode,
          reportId: randomUUID(),
          headSha: report.head_sha,
          issues: drift.issues,
          hasBlockingIssues: drift.issues.some((issue) => issue.severity === 'error'),
        };

        // Every report — preview or baseline — records the commits it names into the shared `commits`
        // ledger (WO-182): `trust` always comes from `mode`, which this route alone computed from the
        // caller's already-verified scope+OIDC decision above, never from anything the request body
        // itself claims. This is what lets WO-183's policy-docs endpoint evaluate a sha's first_seen_at
        // even for a commit that was only ever reported as a preview. `upsertReportedCommits`'s own
        // `trust: 'preview'` write path can never downgrade or overwrite an already-baseline row (see
        // its module doc comment) — the "commit falsificado por un developer" case SDD-010 calls out.
        await upsertReportedCommits(pool, {
          projectId: resolved.projectId,
          orgId: resolved.orgId,
          tokenId: token.tokenId,
          trust: mode,
          branch: report.branch,
          commits: report.commits,
        });

        if (mode === 'baseline') {
          await recordBaselineHead(pool, {
            projectId: resolved.projectId,
            orgId: resolved.orgId,
            headSha: report.head_sha,
            impactsHashes: report.impacts_hashes,
          });
          const engine = resolvePgProjectEngine(pool, requireNeo4j(neo4j), resolved.orgId, project);
          await engine.refresh();
        }

        const outcome = await recordCodeReport(pool, {
          projectId: resolved.projectId,
          orgId: resolved.orgId,
          tokenId: token.tokenId,
          idempotencyKey: idempotencyKeyHeader,
          bodySha256: bodySha256ForIdempotency,
          mode,
          headSha: report.head_sha,
          branch: report.branch,
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
