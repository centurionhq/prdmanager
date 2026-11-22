/**
 * Metrics (WO-272): matches the Planta and Sala de Control headline numbers exactly (median 5
 * min, 99,6 % synced, 100 % features traced, 66,4 % commits traced). `governedTotal` and the
 * commit totals are aggregate, project-wide counts — they intentionally do not equal the length
 * of codeRefs.ts / commits.ts, which only hold a representative sample of rows for this package.
 */
import type { Metrics } from './types';

export const METRICS: Metrics = {
  agentHumanEfficiency: {
    completedWorkOrders: 486,
    measuredWorkOrders: 482,
    avgResolutionHours: 2.35,
    medianResolutionHours: 0.09,
    // SDD-094 (WO-720): the real shape measured on the mirror — p90 373,09 h, max 416,91 h, 115 orders
    // over a day. The worst five are the same ones the canvas drawer lists.
    p90ResolutionHours: 373.09,
    maxResolutionHours: 416.91,
    slowest: {
      thresholdHours: 24,
      total: 115,
      items: [
        { id: 'WO-486', claimedAt: '2026-08-01T10:00:00.000Z', completedAt: '2026-08-18T18:54:36.000Z', resolutionHours: 416.91 },
        { id: 'WO-487', claimedAt: '2026-08-02T09:00:00.000Z', completedAt: '2026-08-16T09:00:00.000Z', resolutionHours: 336 },
        { id: 'WO-488', claimedAt: '2026-08-03T12:00:00.000Z', completedAt: '2026-08-16T22:00:00.000Z', resolutionHours: 322 },
        { id: 'WO-489', claimedAt: '2026-08-04T08:00:00.000Z', completedAt: '2026-08-17T10:00:00.000Z', resolutionHours: 314 },
        { id: 'WO-490', claimedAt: '2026-08-05T10:00:00.000Z', completedAt: '2026-08-18T10:00:00.000Z', resolutionHours: 312 },
      ],
    },
    // WO-683 (SDD-085): the WO-672 note, one order per reason, mixing null and set dates.
    unmeasured: {
      total: 4,
      workOrders: [
        { id: 'WO-001', status: 'done', reason: 'missing_claim', claimedAt: null, completedAt: null },
        { id: 'WO-002', status: 'done', reason: 'missing_completion', claimedAt: '2026-09-27T18:21:00.000Z', completedAt: null },
        { id: 'WO-003', status: 'done', reason: 'invalid_timestamp', claimedAt: null, completedAt: null },
        { id: 'WO-004', status: 'done', reason: 'negative_duration', claimedAt: '2026-09-27T18:21:00.000Z', completedAt: '2026-09-26T10:00:00.000Z' },
      ],
    },
  },
  systemIntegrity: {
    governedTotal: 3254,
    governedSynced: 3241,
    syncedPercent: 99.6,
  },
  traceability: {
    featuresTotal: 12,
    featuresTraced: 12,
    featurePercent: 100,
    commitsTotal: 250,
    commitsWithRefs: 172,
    commitsTraced: 166,
    commitPercent: 66.4,
    // WO-723 (SDD-095 D4): the window the graph's commits are computed over — the report of `main@7c4e9a1`.
    commitsWindow: { branch: 'main', sha: '7c4e9a1d2b3f', reportedAt: '2026-10-05T14:12:00.000Z' },
    // WO-669 (SDD-080): total = 250 - 166 and danglingRefs = 172 - 166, like the real backend. `truncated`
    // is on so the "primeros N de M" notice is visible in the mock; `items` is a sample of the 84.
    // WO-723 (SDD-095 D3): byClass is the same aggregation as total, so 12 + 40 + 32 === 84; each item
    // carries its class, and only the `code` rows are work.
    untracedCommits: {
      total: 84,
      danglingRefs: 6,
      byClass: { merge: 12, bookkeeping: 40, code: 32 },
      truncated: true,
      items: [
        { sha: 'a1b2c3d4e5f6', subject: "Merge branch 'feat/planta' into main", author: 'Tano', date: '2026-10-05T13:02:00.000Z', files: [], gap: 'no_refs', class: 'merge' },
        { sha: 'b71e40a95c3f', subject: 'chore: sube vitest a 4.1', author: 'Tano', date: '2026-10-05T09:40:00.000Z', files: [], gap: 'no_refs', class: 'bookkeeping' },
        { sha: '5d02c8e16ab9', subject: 'docs: aclara el flujo de reclamo de órdenes', author: 'Lucía', date: '2026-10-04T17:05:00.000Z', files: ['README.md', 'docs/flujo.md', 'docs/ordenes.md'], gap: 'no_refs', class: 'bookkeeping' },
        { sha: '3f9a1c2d84e7', subject: 'fix: el filtro de órdenes ignora el estado archivado', author: 'Tano', date: '2026-10-05T14:12:00.000Z', files: ['packages/app/src/routes/Ordenes.tsx'], gap: 'no_refs', class: 'code' },
        { sha: 'e4a6937b20d1', subject: 'feat: lista de commits de la planta', author: 'Lucía', date: '2026-10-04T11:30:00.000Z', files: ['packages/app/src/routes/Planta.tsx'], gap: 'dangling_refs', class: 'code' },
      ],
    },
  },
};
