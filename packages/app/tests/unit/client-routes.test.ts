/**
 * SDD-013 §"Módulos de API": one call-shape check per SDD-012 route added to `packages/app/src/api` —
 * the method, the exact URL (including query string and encoding) and that the parsed return value
 * matches the raw response `request()` would have handed back. `request` itself is spied on rather than
 * `fetch`, exactly like `../client/DocumentDetail.test.tsx` already spies on `client`'s own functions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as requestModule from '../../src/api/request.js';
import {
  claimWorkOrder,
  completeWorkOrder,
  getDriftIssues,
  getDriftReportDetail,
  getFeatureBranch,
  getFeedbackCandidates,
  getLineBoard,
  getMetrics,
  getOrgAuditLog,
  getProjectAuditLog,
  getProjectsOverview,
  getWorkOrderContext,
  listCodeRefs,
  listCommits,
  listInbox,
  resendInvitation,
  searchGraph,
  submitFeedback,
  triageFeedback,
} from '../../src/api/client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function spyOnRequest(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(requestModule, 'request');
}

describe('getLineBoard', () => {
  it('GETs the project line-board and returns it as-is', async () => {
    const board = { features: [], andon: null };
    const spy = spyOnRequest().mockResolvedValue(board);

    await expect(getLineBoard('acme', 'factory')).resolves.toEqual(board);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/line-board');
  });
});

describe('getProjectsOverview', () => {
  it('GETs the org projects overview and unwraps { projects }', async () => {
    const projects = [{ id: 'p1', slug: 'factory', name: 'Factory' }];
    const spy = spyOnRequest().mockResolvedValue({ projects });

    await expect(getProjectsOverview('acme')).resolves.toEqual(projects);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/overview');
  });
});

describe('getMetrics', () => {
  it('GETs the project metrics and returns them as-is', async () => {
    const metrics = { agentHumanEfficiency: {}, systemIntegrity: {}, traceability: {} };
    const spy = spyOnRequest().mockResolvedValue(metrics);

    await expect(getMetrics('acme', 'factory')).resolves.toEqual(metrics);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/metrics');
  });
});

describe('searchGraph', () => {
  it('GETs the graph search endpoint with an encoded q= and unwraps { results }', async () => {
    const results = [{ id: 'FR-001', label: 'Feature', title: 'Login', status: 'draft', score: 0.9 }];
    const spy = spyOnRequest().mockResolvedValue({ results });

    await expect(searchGraph('acme', 'factory', 'inicio de sesión')).resolves.toEqual(results);
    // URLSearchParams (not encodeURIComponent) does the encoding, so a space becomes "+", not "%20".
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/graph/search?q=inicio+de+sesi%C3%B3n');
  });
});

describe('getFeatureBranch', () => {
  it('GETs the feature branch subgraph for the given node id', async () => {
    const subgraph = { nodes: [], edges: [] };
    const spy = spyOnRequest().mockResolvedValue(subgraph);

    await expect(getFeatureBranch('acme', 'factory', 'FR-001')).resolves.toEqual(subgraph);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/graph/branch/FR-001');
  });
});

describe('getWorkOrderContext', () => {
  it('GETs the work order context and unwraps { context }', async () => {
    const context = { workOrder: { id: 'WO-001' } };
    const spy = spyOnRequest().mockResolvedValue({ context });

    await expect(getWorkOrderContext('acme', 'factory', 'WO-001')).resolves.toEqual(context);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/work-orders/WO-001/context');
  });
});

describe('claimWorkOrder', () => {
  it('POSTs an empty body to claim and unwraps { workOrder }', async () => {
    const workOrder = { id: 'WO-001', status: 'in_progress' };
    const spy = spyOnRequest().mockResolvedValue({ workOrder });

    await expect(claimWorkOrder('acme', 'factory', 'WO-001')).resolves.toEqual(workOrder);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/work-orders/WO-001/claim', {
      method: 'POST',
      body: {},
    });
  });
});

describe('completeWorkOrder', () => {
  it('POSTs the commit sha to complete and unwraps { workOrder }', async () => {
    const workOrder = { id: 'WO-001', status: 'done' };
    const spy = spyOnRequest().mockResolvedValue({ workOrder });

    await expect(completeWorkOrder('acme', 'factory', 'WO-001', 'abc1234')).resolves.toEqual(workOrder);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/work-orders/WO-001/complete', {
      method: 'POST',
      body: { commitSha: 'abc1234' },
    });
  });
});

describe('submitFeedback', () => {
  it('POSTs the feedback input and returns the result as-is', async () => {
    const input = { text: 'algo anda mal', source: 'soporte' };
    const result = { id: 'FB-001', linkedTo: [], candidates: [] };
    const spy = spyOnRequest().mockResolvedValue(result);

    await expect(submitFeedback('acme', 'factory', input)).resolves.toEqual(result);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/feedback', {
      method: 'POST',
      body: input,
    });
  });
});

describe('listInbox', () => {
  it('GETs the inbox with no filters and unwraps { items }', async () => {
    const items = [{ id: 'FB-001', kind: 'FB' }];
    const spy = spyOnRequest().mockResolvedValue({ items });

    await expect(listInbox('acme', 'factory')).resolves.toEqual(items);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/inbox');
  });

  it('GETs the inbox with a status filter as a query param', async () => {
    const spy = spyOnRequest().mockResolvedValue({ items: [] });

    await listInbox('acme', 'factory', { status: 'new' });
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/inbox?status=new');
  });
});

describe('getFeedbackCandidates', () => {
  it('GETs the candidates for one inbox item and unwraps { candidates }', async () => {
    const candidates = [{ featureId: 'FR-001', score: 0.8, reason: 'mention' }];
    const spy = spyOnRequest().mockResolvedValue({ candidates });

    await expect(getFeedbackCandidates('acme', 'factory', 'FB-001')).resolves.toEqual(candidates);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/feedback/FB-001/candidates');
  });
});

describe('triageFeedback', () => {
  it('POSTs the triage decision and returns the result as-is', async () => {
    const result = { linkedTo: ['FR-001'] };
    const spy = spyOnRequest().mockResolvedValue(result);

    await expect(triageFeedback('acme', 'factory', 'FB-001', { informs: ['FR-001'] })).resolves.toEqual(result);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/feedback/FB-001/triage', {
      method: 'POST',
      body: { informs: ['FR-001'] },
    });
  });
});

describe('getDriftIssues', () => {
  it('GETs the drift issues and unwraps { issues }', async () => {
    const issues = [{ kind: 'stale_ref', severity: 'error' }];
    const spy = spyOnRequest().mockResolvedValue({ issues });

    await expect(getDriftIssues('acme', 'factory')).resolves.toEqual(issues);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/drift/issues');
  });
});

describe('getDriftReportDetail', () => {
  it('GETs one drift report detail by id', async () => {
    const detail = { id: 'rep_1', issues: [] };
    const spy = spyOnRequest().mockResolvedValue(detail);

    await expect(getDriftReportDetail('acme', 'factory', 'rep_1')).resolves.toEqual(detail);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/drift/reports/rep_1');
  });
});

describe('listCommits', () => {
  it('GETs commits and unwraps the server\'s { commits, nextCursor } envelope into { items, nextCursor } (FB-016, SDD-030)', async () => {
    const commits = [{ sha: 'abc1234', subject: 'feat: x', author: 'me', date: '2026-01-01', refs: [], files: [], trust: 'baseline' }];
    const spy = spyOnRequest().mockResolvedValue({ commits, nextCursor: null });

    await expect(listCommits('acme', 'factory')).resolves.toEqual({ items: commits, nextCursor: null });
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/commits');
  });

  it('GETs commits with limit and cursor as query params', async () => {
    const spy = spyOnRequest().mockResolvedValue({ commits: [], nextCursor: null });

    await listCommits('acme', 'factory', { limit: 20, cursor: 'abc' });
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/commits?limit=20&cursor=abc');
  });
});

describe('listCodeRefs', () => {
  it('GETs code refs and unwraps the server\'s { refs } envelope (FB-016, SDD-030)', async () => {
    const refs = [{ refKey: 'WO-001:src/x.ts' }];
    const spy = spyOnRequest().mockResolvedValue({ refs });

    await expect(listCodeRefs('acme', 'factory')).resolves.toEqual(refs);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/code-refs');
  });
});

describe('getProjectAuditLog', () => {
  it('GETs the project audit log with no params', async () => {
    const page = { items: [], nextCursor: null };
    const spy = spyOnRequest().mockResolvedValue(page);

    await expect(getProjectAuditLog('acme', 'factory')).resolves.toEqual(page);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/projects/factory/audit-log');
  });

  it('GETs the project audit log with action/limit/cursor as query params', async () => {
    const spy = spyOnRequest().mockResolvedValue({ items: [], nextCursor: null });

    await getProjectAuditLog('acme', 'factory', { action: 'wo.claim', limit: 10, cursor: 'xyz' });
    expect(spy).toHaveBeenCalledWith(
      '/api/app/organizations/acme/projects/factory/audit-log?action=wo.claim&limit=10&cursor=xyz',
    );
  });
});

describe('getOrgAuditLog', () => {
  it('GETs the org-level audit log with no project scoping', async () => {
    const page = { items: [], nextCursor: null };
    const spy = spyOnRequest().mockResolvedValue(page);

    await expect(getOrgAuditLog('acme')).resolves.toEqual(page);
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/audit-log');
  });
});

describe('resendInvitation', () => {
  it('POSTs to resend and resolves to undefined', async () => {
    const spy = spyOnRequest().mockResolvedValue(undefined);

    await expect(resendInvitation('acme', 'inv_1')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('/api/app/organizations/acme/invitations/inv_1/resend', { method: 'POST' });
  });
});
