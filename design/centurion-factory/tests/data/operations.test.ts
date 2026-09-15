import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/data/index';
import { DRIFT_ISSUES, DRIFT_REPORTS, driftIssuesForBlueprint } from '../../src/data/drift';
import { COMMITS } from '../../src/data/commits';
import { CODE_REFS } from '../../src/data/codeRefs';
import { METRICS } from '../../src/data/metrics';
import { INBOX_ITEMS } from '../../src/data/inbox';
import { PEOPLE, INVITATIONS } from '../../src/data/people';
import { PROJECTS } from '../../src/data/projects';
import { CI_TOKENS } from '../../src/data/tokens';
import { SSO_SETTINGS } from '../../src/data/sso';
import { getFeature } from '../../src/data/features';
import { getBlueprint } from '../../src/data/blueprints';
import { getWorkOrder } from '../../src/data/workOrders';
import type { DriftKind, Severity } from '../../src/data/types';

const ALL_DRIFT_KINDS: readonly DriftKind[] = [
  'broken_link',
  'invalid_link_target',
  'feature_changed',
  'blueprint_changed',
  'code_out_of_sync',
  'work_order_out_of_sync',
  'status_write_failed',
  'impacts_warning',
  'deprecated_field',
  'lifecycle_violation',
  'awaiting_ci_report',
];

function uniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

describe('drift issues', () => {
  it('has exactly 14 issues', () => {
    expect(DRIFT_ISSUES).toHaveLength(14);
  });

  it('covers every drift kind and severity', () => {
    for (const kind of ALL_DRIFT_KINDS) expect(DRIFT_ISSUES.some((i) => i.kind === kind)).toBe(true);
    const severities: readonly Severity[] = ['error', 'warning'];
    for (const severity of severities) expect(DRIFT_ISSUES.some((i) => i.severity === severity)).toBe(true);
  });

  it('has at least 3 errors tied to FR-002 or SDD-012', () => {
    const relevant = DRIFT_ISSUES.filter(
      (i) => i.severity === 'error' && (i.featureId === 'FR-002' || i.blueprintId === 'SDD-012'),
    );
    expect(relevant.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves every featureId and blueprintId to an existing node', () => {
    for (const issue of DRIFT_ISSUES) {
      if (issue.featureId) expect(getFeature(issue.featureId)).toBeDefined();
      if (issue.blueprintId) expect(getBlueprint(issue.blueprintId)).toBeDefined();
    }
  });

  it('includes the WO-310 work_order_out_of_sync issue on SDD-012', () => {
    const issue = driftIssuesForBlueprint('SDD-012').find((i) => i.kind === 'work_order_out_of_sync');
    expect(issue?.nodeId).toBe('WO-310');
  });
});

describe('drift reports', () => {
  it('has a baseline report for main and preview reports for the three branches', () => {
    const baseline = DRIFT_REPORTS.find((r) => r.mode === 'baseline' && r.headSha === '8f2c1d4');
    expect(baseline?.branch).toBe('main');
    expect(baseline?.issueCount).toBe(6);

    const previewBranches = DRIFT_REPORTS.filter((r) => r.mode === 'preview').map((r) => r.branch).sort();
    expect(previewBranches).toEqual(['feat/fr-002-importer', 'feat/fr-003-avisos', 'fix/scan-timeout'].sort());
  });

  it('marks fix/scan-timeout as awaiting CI', () => {
    const report = DRIFT_REPORTS.find((r) => r.branch === 'fix/scan-timeout');
    expect(report?.awaitingCi).toBe(true);
  });

  it('has 5 baseline history entries for main', () => {
    expect(DRIFT_REPORTS.filter((r) => r.mode === 'baseline' && r.branch === 'main')).toHaveLength(5);
  });
});

describe('commits', () => {
  it('has exactly 24 commits with Refs', () => {
    expect(COMMITS).toHaveLength(24);
    for (const commit of COMMITS) expect(commit.refs.length).toBeGreaterThan(0);
  });

  it('uses unique 7-char hex shas', () => {
    expect(uniqueIds(COMMITS.map((c) => c.sha))).toBe(true);
    for (const commit of COMMITS) expect(commit.sha).toMatch(/^[0-9a-f]{7}$/);
  });

  it('resolves every ref to an existing work order', () => {
    for (const commit of COMMITS) {
      for (const ref of commit.refs) expect(getWorkOrder(ref)).toBeDefined();
    }
  });
});

describe('code refs', () => {
  it('resolves every code ref to an existing blueprint', () => {
    for (const ref of CODE_REFS) expect(getBlueprint(ref.blueprintId)).toBeDefined();
  });

  it('marks the SDD-012 importer paths as out of sync and the CLI path as synced', () => {
    const scan = CODE_REFS.find((r) => r.path === 'packages/server/src/import/scan.ts');
    const cli = CODE_REFS.find((r) => r.path === 'packages/cli/src/commands/import.ts');
    expect(scan?.status).toBe('out_of_sync');
    expect(cli?.status).toBe('synced');
  });
});

describe('metrics', () => {
  it('matches the canvas headline numbers', () => {
    expect(METRICS.agentHumanEfficiency.medianResolutionHours).toBeCloseTo(0.09, 2);
    expect(METRICS.systemIntegrity.governedTotal).toBe(3254);
    expect(Math.round(METRICS.systemIntegrity.syncedPercent * 10) / 10).toBe(99.6);
    expect(METRICS.traceability.featurePercent).toBe(100);
    expect(Math.round(METRICS.traceability.commitPercent * 10) / 10).toBe(66.4);
  });
});

describe('inbox', () => {
  it('has exactly 14 items', () => {
    expect(INBOX_ITEMS).toHaveLength(14);
  });

  it('covers new and triaged statuses', () => {
    expect(INBOX_ITEMS.some((i) => i.status === 'new')).toBe(true);
    expect(INBOX_ITEMS.some((i) => i.status === 'triaged')).toBe(true);
  });

  it('gives FB-007 and FB-008 candidates that resolve to real features', () => {
    for (const id of ['FB-007', 'FB-008']) {
      const item = INBOX_ITEMS.find((i) => i.id === id);
      expect(item?.status).toBe('new');
      expect(item?.candidates.length).toBeGreaterThan(0);
      for (const candidate of item?.candidates ?? []) expect(getFeature(candidate.featureId)).toBeDefined();
    }
  });
});

describe('people', () => {
  it('has exactly 8 people and 1 pending invitation', () => {
    expect(PEOPLE).toHaveLength(8);
    expect(INVITATIONS).toHaveLength(1);
    expect(INVITATIONS[0]?.email).toBe('tomas@centurionhq.com');
  });

  it('uses unique ids and emails', () => {
    expect(uniqueIds(PEOPLE.map((p) => p.id))).toBe(true);
    expect(uniqueIds(PEOPLE.map((p) => p.email))).toBe(true);
  });

  it('includes the 5 named people from the brief', () => {
    const names = PEOPLE.map((p) => p.name);
    for (const name of ['Ana Ríos', 'Julia Paz', 'Martín Sosa', 'Lucas Vera', 'Sofía Ibarra']) {
      expect(names).toContain(name);
    }
  });
});

describe('projects', () => {
  it('has exactly the 5 organization projects', () => {
    expect(PROJECTS.map((p) => p.slug).sort()).toEqual(
      ['centurion-core', 'data-report-ms', 'dbmazz', 'prdmanager', 'ystream'].sort(),
    );
  });

  it('matches the canvas numbers for prdmanager', () => {
    const prdmanager = PROJECTS.find((p) => p.slug === 'prdmanager');
    expect(prdmanager?.documentCount).toBe(292);
    expect(prdmanager?.driftErrors).toBe(3);
    expect(prdmanager?.workOrdersInProgress).toBe(9);
  });

  it('marks data-report-ms as awaiting its first report and centurion-core as archived', () => {
    expect(PROJECTS.find((p) => p.slug === 'data-report-ms')?.awaitingFirstReport).toBe(true);
    expect(PROJECTS.find((p) => p.slug === 'centurion-core')?.archived).toBe(true);
  });
});

describe('CI tokens', () => {
  it('has the 3 tokens from the canvas, one of them expired', () => {
    expect(CI_TOKENS).toHaveLength(3);
    expect(CI_TOKENS.filter((t) => t.expired)).toHaveLength(1);
  });

  it('gives the main branch token the baseline scope', () => {
    const main = CI_TOKENS.find((t) => t.name === 'github-actions-main');
    expect(main?.scopes).toContain('reports:baseline');
  });
});

describe('SSO settings', () => {
  it('is configured for Okta over OIDC with one verified domain', () => {
    expect(SSO_SETTINGS.protocol).toBe('oidc');
    expect(SSO_SETTINGS.provider).toBe('Okta');
    expect(SSO_SETTINGS.domains.filter((d) => d.verified)).toHaveLength(1);
    expect(SSO_SETTINGS.domains.filter((d) => !d.verified)).toHaveLength(1);
  });
});

describe('barrel', () => {
  it('re-exports every data module', () => {
    expect(barrel.FEATURES).toBeDefined();
    expect(barrel.BLUEPRINTS).toBeDefined();
    expect(barrel.WORK_ORDERS).toBeDefined();
    expect(barrel.DOCUMENTS).toBeDefined();
    expect(barrel.DRIFT_ISSUES).toBeDefined();
    expect(barrel.COMMITS).toBeDefined();
    expect(barrel.METRICS).toBeDefined();
    expect(barrel.PEOPLE).toBeDefined();
    expect(barrel.PROJECTS).toBeDefined();
    expect(barrel.CI_TOKENS).toBeDefined();
    expect(barrel.SSO_SETTINGS).toBeDefined();
  });
});
