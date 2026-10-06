/**
 * Metrics (WO-272): matches the Planta and Sala de Control headline numbers exactly (median 5
 * min, 99,6 % synced, 100 % features traced, 66,4 % commits traced). `governedTotal` and the
 * commit totals are aggregate, project-wide counts — they intentionally do not equal the length
 * of codeRefs.ts / commits.ts, which only hold a representative sample of rows for this package.
 */
import type { Metrics } from './types';

export const METRICS: Metrics = {
  agentHumanEfficiency: {
    completedWorkOrders: 28,
    measuredWorkOrders: 28,
    avgResolutionHours: 2.35,
    medianResolutionHours: 0.09,
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
    // WO-669 (SDD-080): total = 250 - 166 and danglingRefs = 172 - 166, like the real backend. `truncated`
    // is on so the "primeros N de M" notice is visible in the mock; `items` is a sample of the 84.
    untracedCommits: {
      total: 84,
      danglingRefs: 6,
      truncated: true,
      items: [
        { sha: '3f9a1c2d84e7', subject: 'fix: el filtro de órdenes ignora el estado archivado', author: 'Tano', date: '2026-10-05T14:12:00.000Z', files: ['packages/app/src/routes/Ordenes.tsx'], gap: 'no_refs' },
        { sha: 'b71e40a95c3f', subject: 'chore: sube vitest a 4.1', author: 'Tano', date: '2026-10-05T09:40:00.000Z', files: ['package.json', 'package-lock.json'], gap: 'no_refs' },
        { sha: '5d02c8e16ab9', subject: 'docs: aclara el flujo de reclamo de órdenes', author: 'Lucía', date: '2026-10-04T17:05:00.000Z', files: ['README.md', 'docs/flujo.md', 'docs/ordenes.md'], gap: 'no_refs' },
        { sha: 'e4a6937b20d1', subject: 'feat: lista de commits de la planta', author: 'Lucía', date: '2026-10-04T11:30:00.000Z', files: ['packages/app/src/routes/Planta.tsx'], gap: 'dangling_refs' },
      ],
    },
  },
};
