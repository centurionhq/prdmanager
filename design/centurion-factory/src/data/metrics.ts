/**
 * Metrics (WO-272): matches the Planta and Sala de Control headline numbers exactly (median 5
 * min, 99,6 % synced, 100 % features traced, 66,4 % commits with Refs). `governedTotal` and the
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
    commitsWithRefs: 166,
    commitsTraced: 166,
    commitPercent: 66.4,
  },
};
