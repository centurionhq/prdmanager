import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeDetail, Subgraph, TreeNode } from '@prdm/core';
import type { CommitDto, DriftIssueDto, SuccessMetricsDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { ProjectGraph } from '../../src/routes/ProjectGraph.js';
import { makeProjectShellContext } from './fixtures.js';

const FOREST: TreeNode[] = [
  {
    ref: 'MRD-001',
    label: 'Feature',
    kind: 'MRD',
    title: 'Mercado: contexto de producto',
    status: 'approved',
    via: null,
    edgeStatus: null,
    reviewNeeded: false,
    repeated: false,
    children: [
      {
        ref: 'FR-001',
        label: 'Feature',
        kind: 'FR',
        title: 'Persistencia de borradores',
        status: 'approved',
        via: 'EVOLVES_FROM',
        edgeStatus: 'synced',
        reviewNeeded: false,
        repeated: false,
        children: [],
      },
      {
        ref: 'FR-002',
        label: 'Feature',
        kind: 'FR',
        title: 'Importador incremental',
        status: 'closed',
        via: 'EVOLVES_FROM',
        edgeStatus: 'synced',
        reviewNeeded: false,
        repeated: false,
        children: [],
      },
    ],
  },
];

/** Rework de WO-678: dos subárboles independientes, para reproducir «tipear sobre un filtro ya activo» —
 * con el bosque filtrado cambiando sin remount. */
const DEEP_FOREST: TreeNode[] = [
  {
    ref: 'MRD-001', label: 'Feature', kind: 'MRD', title: 'Mercado: contexto de producto', status: 'approved',
    via: null, edgeStatus: null, reviewNeeded: false, repeated: false,
    children: [
      {
        ref: 'PRD-020', label: 'Feature', kind: 'PRD', title: 'Panel de salud de cuenta', status: 'approved',
        via: 'EVOLVES_FROM', edgeStatus: 'synced', reviewNeeded: false, repeated: false,
        children: [
          { ref: 'FR-030', label: 'Feature', kind: 'FR', title: 'Alertas de churn', status: 'approved', via: 'EVOLVES_FROM', edgeStatus: 'synced', reviewNeeded: false, repeated: false, children: [] },
        ],
      },
    ],
  },
  {
    ref: 'MRD-002', label: 'Feature', kind: 'MRD', title: 'Mercado: expansión', status: 'approved',
    via: null, edgeStatus: null, reviewNeeded: false, repeated: false,
    children: [
      {
        ref: 'PRD-021', label: 'Feature', kind: 'PRD', title: 'Exportación de reportes', status: 'approved',
        via: 'EVOLVES_FROM', edgeStatus: 'synced', reviewNeeded: false, repeated: false,
        children: [
          { ref: 'FR-031', label: 'Feature', kind: 'FR', title: 'Reporte csv', status: 'approved', via: 'EVOLVES_FROM', edgeStatus: 'synced', reviewNeeded: false, repeated: false, children: [] },
        ],
      },
    ],
  },
];

function nodeDetailFor(ref: string): NodeDetail {
  if (ref === 'FR-001') {
    return {
      node: { id: 'FR-001', label: 'Feature', kind: 'FR', title: 'Persistencia de borradores', status: 'approved', body: '', tags: [], source_path: '', mirrorPath: '.prdm/remote/docs/FR-001.md', created_at: null },
      links: [
        { type: 'ARCHITECTS', direction: 'in', ref: 'SDD-005', title: 'SDD-005', props: {} },
        { type: 'JUSTIFIED_BY', direction: 'out', ref: 'FB-004', title: 'FB-004', props: {} },
      ],
    };
  }
  if (ref === 'SDD-005') {
    return {
      node: { id: 'SDD-005', label: 'Blueprint', kind: 'SDD', title: 'Diseño de persistencia', status: 'published', body: '', tags: [], source_path: '', mirrorPath: '.prdm/remote/docs/SDD-005.md', created_at: null },
      links: [
        { type: 'ARCHITECTS', direction: 'out', ref: 'FR-001', title: 'FR-001', props: {} },
        { type: 'IMPLEMENTS', direction: 'in', ref: 'WO-100', title: 'WO-100', props: {} },
      ],
    };
  }
  return {
    node: { id: ref, label: 'Feature', kind: 'MRD', title: 'Mercado: contexto de producto', status: 'approved', body: '', tags: [], source_path: '', mirrorPath: `.prdm/remote/docs/${ref}.md`, created_at: null },
    links: [],
  };
}

const BRANCH: Subgraph = {
  nodes: [
    { ref: 'SDD-005', label: 'Blueprint', kind: 'SDD', title: 'Diseño', status: 'published' },
    { ref: 'WO-100', label: 'WorkOrder', kind: 'WO', title: 'Implementación', status: 'done' },
    { ref: 'WO-101', label: 'WorkOrder', kind: 'WO', title: 'Tests', status: 'pending' },
  ],
  edges: [],
};

/** WO-749: un subgrafo con `count` órdenes (más el SDD que las sostiene) para medir el tope del panel. */
function branchWithOrders(count: number): Subgraph {
  return {
    nodes: [
      { ref: 'SDD-005', label: 'Blueprint', kind: 'SDD', title: 'Diseño', status: 'published' },
      ...Array.from({ length: count }, (_, index) => ({
        ref: `WO-${100 + index}`,
        label: 'WorkOrder',
        kind: 'WO',
        title: `Orden ${100 + index}`,
        status: 'pending',
      })),
    ],
    edges: [],
  };
}

const READY = { featureId: 'FR-001', ready: true, checks: [{ name: 'feature_exists', ok: true, detail: 'FR-001 existe' }] };
const NOT_READY = {
  featureId: 'FR-001',
  ready: false,
  checks: [
    { name: 'feature_exists', ok: true, detail: 'FR-001 existe' },
    { name: 'project_clean', ok: false, detail: 'Hay drift' },
  ],
};

/**
 * WO-457 (SDD-029): a raw forest shaped like `getTree` actually returns it today -- blueprints, commits
 * and code paths as tree nodes, and a PRD rendered fully under its `EVOLVES_FROM` parent (MRD-001) with an
 * empty `repeated` stub under the BC its `JUSTIFIED_BY` edge resolves to, exactly as `buildForest`
 * (server) would produce for a PRD that has both an `evolves_from` and a `justified_by`.
 */
const RAW_MIXED_FOREST: TreeNode[] = [
  {
    ref: 'MRD-001',
    label: 'Feature',
    kind: 'MRD',
    title: 'Mercado: contexto de producto',
    status: 'approved',
    via: null,
    edgeStatus: null,
    reviewNeeded: false,
    repeated: false,
    children: [
      {
        ref: 'PRD-020',
        label: 'Feature',
        kind: 'PRD',
        title: 'Panel de salud de cuenta',
        status: 'approved',
        via: 'EVOLVES_FROM',
        edgeStatus: 'synced',
        reviewNeeded: false,
        repeated: false,
        children: [
          { ref: 'FR-030', label: 'Feature', kind: 'FR', title: 'Alertas de churn', status: 'approved', via: 'EVOLVES_FROM', edgeStatus: 'synced', reviewNeeded: false, repeated: false, children: [] },
        ],
      },
    ],
  },
  {
    ref: 'BC-002',
    label: 'Feature',
    kind: 'BC',
    title: 'Reducir el churn de cuentas',
    status: 'approved',
    via: null,
    edgeStatus: null,
    reviewNeeded: false,
    repeated: false,
    children: [
      { ref: 'PRD-020', label: 'Feature', kind: 'PRD', title: 'Panel de salud de cuenta', status: 'approved', via: 'JUSTIFIED_BY', edgeStatus: 'synced', reviewNeeded: false, repeated: true, children: [] },
    ],
  },
  {
    ref: 'SDD-777',
    label: 'Blueprint',
    kind: 'SDD',
    title: 'Diseño interno',
    status: 'published',
    via: null,
    edgeStatus: null,
    reviewNeeded: false,
    repeated: false,
    children: [
      { ref: 'commit:abc123', label: 'Commit', kind: null, title: 'abc123', status: null, via: 'IMPLEMENTS', edgeStatus: null, reviewNeeded: false, repeated: false, children: [] },
      { ref: 'code:packages/server/src/x.ts', label: 'CodeRef', kind: null, title: 'x.ts', status: null, via: 'IMPLEMENTS', edgeStatus: null, reviewNeeded: false, repeated: false, children: [] },
    ],
  },
];

function nodeDetailForMixed(ref: string): NodeDetail {
  return { node: { id: ref, label: 'Feature', kind: ref.split('-')[0] ?? '', title: ref, status: 'approved', body: '', tags: [], source_path: '', mirrorPath: `.prdm/remote/docs/${ref}.md`, created_at: null }, links: [] };
}

const METRICS: SuccessMetricsDto = {
  agentHumanEfficiency: { completedWorkOrders: 3, measuredWorkOrders: 3, avgResolutionHours: 0.2, medianResolutionHours: 0.15, unmeasured: { total: 0, workOrders: [] } },
  systemIntegrity: { governedTotal: 5, governedSynced: 5, syncedPercent: 100 },
  traceability: { featuresTotal: 3, featuresTraced: 3, orphanFeatures: [], featurePercent: 100, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0, commitPercent: null, untracedCommits: { total: 0, danglingRefs: 0, truncated: false, items: [] } },
};

const ONE_ORPHAN: SuccessMetricsDto = {
  ...METRICS,
  traceability: {
    ...METRICS.traceability,
    featuresTotal: 3,
    featuresTraced: 2,
    featurePercent: 66.7,
    orphanFeatures: [{ id: 'FR-002', kind: 'FR', title: 'Importador incremental', status: 'closed' }],
  },
};

/** WO-750: dos huérfanas sobre un árbol de tres features -- el conjunto filtrado deja de ser el total. */
const TWO_ORPHANS: SuccessMetricsDto = {
  ...METRICS,
  traceability: {
    ...METRICS.traceability,
    featuresTotal: 3,
    featuresTraced: 1,
    featurePercent: 33.3,
    orphanFeatures: [
      { id: 'FR-001', kind: 'FR', title: 'Persistencia de borradores', status: 'approved' },
      { id: 'FR-002', kind: 'FR', title: 'Importador incremental', status: 'closed' },
    ],
  },
};

function renderPage(id?: string, subject: Parameters<typeof makeProjectShellContext> = ['owner', 'admin'], search = '') {
  const context = makeProjectShellContext(...subject);
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug',
        element: <Outlet context={context} />,
        children: [{ path: 'arbol/:id?', element: <ProjectGraph /> }],
      },
    ],
    { initialEntries: [`/o/${context.orgSlug}/p/${context.projectSlug}/arbol${id ? `/${id}` : ''}${search}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('ProjectGraph (árbol de features)', () => {
  beforeEach(() => {
    vi.spyOn(client, 'getMetrics').mockResolvedValue(METRICS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearQueryCache();
  });

  it('selects the first root by default and shows its traceability panel', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

    renderPage();

    expect(await screen.findByRole('tree', { name: /árbol de features/i })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /MRD-001/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Mercado'));
  });

  it('ArrowDown moves the roving tabindex to the next visible row', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

    renderPage();
    const root = await screen.findByRole('treeitem', { name: /MRD-001/ });
    root.focus();
    await userEvent.keyboard('{ArrowDown}');

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /FR-001/ })));
  });

  it('Enter selects the focused row and loads its traceability panel', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

    renderPage();
    const root = await screen.findByRole('treeitem', { name: /MRD-001/ });
    root.focus();
    await userEvent.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Persistencia de borradores'));
    expect(screen.getByRole('treeitem', { name: /FR-001/ })).toHaveProperty('ariaSelected', 'true');
  });

  it('shows blueprint/work-order counts from getFeatureBranch for a selected feature', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

    renderPage('FR-001');

    expect(await screen.findByText(/1 de 2 hechas/)).toBeTruthy();
  });

  it('shows code refs and commits from listCodeRefs/listCommits for a selected blueprint', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'listCodeRefs').mockResolvedValue([
      { projectId: 'p1', orgId: 'o1', blueprintId: 'SDD-005', refKey: 'k1', path: 'src/a.ts', symbol: null, hash: null, hashAlgoVersion: 1, reportId: 'r1', headSha: 'abc1234', updatedAt: '2026-01-01' },
    ]);
    const commit: CommitDto = { sha: 'abc1234', subject: 'feat: x', author: 'me', date: '2026-01-01', refs: ['SDD-005'], files: [], trust: 'baseline' };
    vi.spyOn(client, 'listCommits').mockResolvedValue({ items: [commit], nextCursor: null });

    renderPage('SDD-005');

    expect(await screen.findByText(/1 referencia/)).toBeTruthy();
    expect(screen.getByText(/1 commit/)).toBeTruthy();
  });

  it('an admin can review closure readiness and close a ready feature', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    vi.spyOn(client, 'getClosureReadiness').mockResolvedValue(READY);
    const close = vi.spyOn(client, 'closeFeature').mockResolvedValue({ result: { featureId: 'FR-001', closedAt: '2026-01-01', closedBy: 'me' } });

    renderPage('FR-001');
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar feature' }));

    const dialog = await screen.findByRole('dialog', { name: /cerrar feature/i });
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar cierre' }));

    await waitFor(() => expect(close).toHaveBeenCalledWith('acme', 'web', 'FR-001'));
    expect(dialog).toBeTruthy();
  });

  it('disables the confirm button until every closure check passes', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    vi.spyOn(client, 'getClosureReadiness').mockResolvedValue(NOT_READY);

    renderPage('FR-001');
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar feature' }));

    expect(await screen.findByText('Hay drift')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toHaveProperty('disabled', true);
  });

  it('an admin sees "Forzar cierre" when a bypassable check fails, and it only bypasses that check (SDD-031, WO-463)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    vi.spyOn(client, 'getClosureReadiness').mockResolvedValue(NOT_READY);
    const forceClose = vi.spyOn(client, 'forceCloseFeature').mockResolvedValue({ result: { featureId: 'FR-001', closedAt: '2026-01-01', closedBy: 'me', reason: 'porque sí', bypassed: [] } });

    renderPage('FR-001');
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar feature' }));

    const forceButton = await screen.findByRole('button', { name: 'Forzar cierre' });
    expect(screen.getByText(/va a saltear: project_clean/)).toBeTruthy();
    expect(forceButton).toHaveProperty('disabled', true);

    await userEvent.type(screen.getByLabelText('Motivo (obligatorio)'), 'Drift preexistente, no relacionado');
    expect(forceButton).toHaveProperty('disabled', false);
    await userEvent.click(forceButton);

    await waitFor(() => expect(forceClose).toHaveBeenCalledWith('acme', 'web', 'FR-001', { reason: 'Drift preexistente, no relacionado', bypass: ['project_clean'] }));
  });

  it('a non-admin never even sees the "Cerrar feature" trigger (close_feature and force_close_feature are both admin-only)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

    renderPage('FR-001', ['member', 'viewer']);

    await waitFor(() => expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Persistencia de borradores'));
    expect(screen.queryByRole('button', { name: 'Cerrar feature' })).toBeNull();
  });

  it('hides "Forzar cierre" for an admin once every check already passes (nothing to bypass)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    vi.spyOn(client, 'getClosureReadiness').mockResolvedValue(READY);

    renderPage('FR-001');
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar feature' }));

    await screen.findByRole('button', { name: 'Confirmar cierre' });
    expect(screen.queryByRole('button', { name: 'Forzar cierre' })).toBeNull();
  });

  it('shows an error state when the tree fails to load', async () => {
    vi.spyOn(client, 'getTree').mockRejectedValue(new Error('tree down'));

    renderPage();

    expect(await screen.findByText(/no pudimos cargar el árbol/i)).toBeTruthy();
  });

  it('filters the tree to features only, dropping blueprints, commits and code paths as tree rows (WO-457)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: RAW_MIXED_FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailForMixed(ref)));

    renderPage();

    await screen.findByRole('tree', { name: /árbol de features/i });
    expect(screen.queryByText(/SDD-777/)).toBeNull();
    expect(screen.queryByText(/commit:abc123/)).toBeNull();
    expect(screen.queryByText(/code:packages/)).toBeNull();
    expect(screen.getByRole('treeitem', { name: /FR-030/ })).toBeTruthy();
  });

  it('nests a PRD under the BC its JUSTIFIED_BY edge resolves to, instead of under its EVOLVES_FROM parent (WO-457)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: RAW_MIXED_FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailForMixed(ref)));

    renderPage();

    const bcRow = await screen.findByRole('treeitem', { name: /BC-002/ });
    const mrdRow = screen.getByRole('treeitem', { name: /MRD-001/ });
    // PRD-020 shows up exactly once, as a child of BC-002 rather than of MRD-001.
    expect(screen.getAllByRole('treeitem', { name: /PRD-020/ })).toHaveLength(1);
    const prdRow = screen.getByRole('treeitem', { name: /PRD-020/ });
    expect(prdRow.getAttribute('aria-level')).toBe(String(Number(bcRow.getAttribute('aria-level')) + 1));
    // MRD-001 lost its only child (PRD-020 moved to BC-002), so it no longer renders as expandable.
    expect(mrdRow.getAttribute('aria-expanded')).toBeNull();
    // FR-030 (PRD-020's own child) moved with it, one level below PRD-020's new position.
    const frRow = screen.getByRole('treeitem', { name: /FR-030/ });
    expect(frRow.getAttribute('aria-level')).toBe(String(Number(prdRow.getAttribute('aria-level')) + 1));
  });

  it('shows how many features are on the tree and how many are closed, and "Contraer todo" collapses every row (WO-457)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

    renderPage();

    // FOREST: MRD-001 -> FR-001 (approved), FR-002 (closed) -- 3 features, 1 closed.
    await screen.findByRole('tree', { name: /árbol de features/i });
    expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '3 features, 1 cerradas')).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /FR-001/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Contraer todo' }));

    expect(screen.queryByRole('treeitem', { name: /FR-001/ })).toBeNull();
    expect(screen.getByRole('treeitem', { name: /MRD-001/ })).toHaveProperty('ariaExpanded', 'false');
  });

  it('shows code refs and commits for a selected FEATURE, narrowed to its own blueprints from getFeatureBranch, and a link to its orders (WO-458)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    vi.spyOn(client, 'listCodeRefs').mockResolvedValue([
      { projectId: 'p1', orgId: 'o1', blueprintId: 'SDD-005', refKey: 'k1', path: 'src/a.ts', symbol: null, hash: null, hashAlgoVersion: 1, reportId: 'r1', headSha: 'abc1234', updatedAt: '2026-01-01' },
      { projectId: 'p1', orgId: 'o1', blueprintId: 'SDD-999', refKey: 'k2', path: 'src/unrelated.ts', symbol: null, hash: null, hashAlgoVersion: 1, reportId: 'r1', headSha: 'abc1234', updatedAt: '2026-01-01' },
    ]);
    const commit: CommitDto = { sha: 'abc1234', subject: 'feat: x', author: 'me', date: '2026-01-01', refs: ['SDD-005'], files: [], trust: 'baseline' };
    vi.spyOn(client, 'listCommits').mockResolvedValue({ items: [commit], nextCursor: null });

    renderPage('FR-001');

    // BRANCH has SDD-005 (its only blueprint), so only the ref/commit attributed to SDD-005 counts --
    // the one attributed to the unrelated SDD-999 is excluded even though listCodeRefs is project-wide.
    expect(await screen.findByText(/1 referencia\b/)).toBeTruthy();
    expect(screen.getByText(/1 commit\b/)).toBeTruthy();

    const link = screen.getByRole('link', { name: /ver las 2 órdenes/i });
    expect(link.getAttribute('href')).toBe('/o/acme/p/web/ordenes');
  });

  it('shows the orders table (status, commit, date) and the governed-code table for a selected feature (WO-459)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    vi.spyOn(client, 'listCodeRefs').mockResolvedValue([
      { projectId: 'p1', orgId: 'o1', blueprintId: 'SDD-005', refKey: 'k1', path: 'src/a.ts', symbol: 'doThing', hash: null, hashAlgoVersion: 1, reportId: 'r1', headSha: 'abc1234567', updatedAt: '2026-01-01' },
    ]);
    const commit: CommitDto = { sha: 'abc1234567', subject: 'feat: x', author: 'me', date: '2026-01-02', refs: ['WO-100'], files: [], trust: 'baseline' };
    vi.spyOn(client, 'listCommits').mockResolvedValue({ items: [commit], nextCursor: null });

    renderPage('FR-001');

    // BRANCH: WO-100 (done, resolved by the commit above) and WO-101 (pending, no matching commit).
    const doneRow = await screen.findByRole('row', { name: /WO-100/ });
    expect(within(doneRow).getByText('abc1234')).toBeTruthy();
    expect(within(doneRow).getByText('2026-01-02')).toBeTruthy();

    const pendingRow = screen.getByRole('row', { name: /WO-101/ });
    expect(within(pendingRow).getAllByText('—').length).toBeGreaterThan(0);

    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('doThing')).toBeTruthy();
  });

  it('shows a real EmptyState (not a blank "Trazabilidad" heading) for a non-feature document reached by url (WO-460)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => {
      if (ref === 'WO-999') {
        return Promise.resolve({
          node: { id: 'WO-999', label: 'WorkOrder', kind: 'WO', title: 'Orden suelta', status: 'pending', body: '', tags: [], source_path: '', mirrorPath: '.prdm/remote/docs/WO-999.md', created_at: null },
          links: [],
        });
      }
      return Promise.resolve(nodeDetailFor(ref));
    });

    // The tree is features-only (WO-457), so WO-999 has no row -- reached only by typing it into the url,
    // exactly PRD-013 §4.3's "documento que no es feature" case.
    renderPage('WO-999');

    expect(await screen.findByText('Orden suelta')).toBeTruthy();
    expect(screen.getByText('Todavía no hay trazabilidad')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows every counter as an explicit zero for a feature with real (empty) branch/code/commit data, never the EmptyState (WO-460)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue({ nodes: [], edges: [] });
    vi.spyOn(client, 'listCodeRefs').mockResolvedValue([]);
    vi.spyOn(client, 'listCommits').mockResolvedValue({ items: [], nextCursor: null });

    renderPage(); // MRD-001, the default root -- a real Feature, just one with nothing linked yet.

    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByText('Todavía no hay trazabilidad')).toBeNull();
    expect(screen.getByText('0 de 0 hechas')).toBeTruthy();
    expect(await screen.findByText('0 referencias')).toBeTruthy();
    expect(screen.getByText('0 commits')).toBeTruthy();
  });

  it('the "Buscar por id o título" field filters the tree, keeping a match\'s ancestors (WO-461; el conteo del header pasa a «N resultados de M features» por SDD-083 D2)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

    renderPage();

    await screen.findByRole('treeitem', { name: /FR-002/ });
    expect(screen.getByRole('treeitem', { name: /FR-001/ })).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Buscar por id o título'), 'FR-001');

    // FR-002 no longer matches and drops out, but MRD-001 (FR-001's ancestor) stays for context.
    expect(screen.queryByRole('treeitem', { name: /FR-002/ })).toBeNull();
    expect(screen.getByRole('treeitem', { name: /FR-001/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /MRD-001/ })).toBeTruthy();
    // SDD-083 D2: mientras hay búsqueda el header cuenta resultados (FR-001 + su ancestro MRD-001) sobre el total.
    expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '2 resultados de 3 features')).toBeTruthy();
  });

  it('shows a drift dot next to a feature with an open drift issue (WO-457)', async () => {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    const issue: DriftIssueDto = { kind: 'code_out_of_sync', severity: 'error', nodeId: 'SDD-005', target: 'src/a.ts', message: 'drift', id: 'abc123', featureIds: ['FR-001'], blueprintId: 'SDD-005', station: null, detectedAt: '2026-01-01' };
    vi.spyOn(client, 'getDriftIssues').mockResolvedValue([issue]);

    renderPage();

    const row = await screen.findByRole('treeitem', { name: /FR-001/ });
    await waitFor(() => expect(within(row).getByTitle('Drift activo')).toBeTruthy());
    expect(within(screen.getByRole('treeitem', { name: /MRD-001/ })).queryByTitle('Drift activo')).toBeNull();
  });

  function mockTree(): void {
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
  }

  describe('buscador en la URL (SDD-083)', () => {
    const spanText = (text: string) => (_: string, element: Element | null) => element?.tagName === 'SPAN' && element.textContent === text;

    it('writes ?q= to the URL, reads it on mount, and clears the param (D1)', async () => {
      mockTree();
      const router = renderPage();
      await screen.findByRole('treeitem', { name: /FR-002/ });

      await userEvent.type(screen.getByLabelText('Buscar por id o título'), 'Importador');
      expect(router.state.location.search).toBe('?q=Importador');
      expect(screen.queryByRole('treeitem', { name: /FR-001/ })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Borrar búsqueda' }));
      expect(router.state.location.search).toBe('');
      expect(screen.getByRole('treeitem', { name: /FR-001/ })).toBeTruthy();
    });

    it('filters when mounted with ?q= (D1)', async () => {
      mockTree();
      renderPage(undefined, ['owner', 'admin'], '?q=Importador');
      await screen.findByRole('treeitem', { name: /FR-002/ });
      expect(screen.queryByRole('treeitem', { name: /FR-001/ })).toBeNull();
    });

    it('says "N resultados de M features" while searching (D2)', async () => {
      mockTree();
      renderPage(undefined, ['owner', 'admin'], '?q=FR-002');
      expect(await screen.findByText(spanText('2 resultados de 3 features'))).toBeTruthy();
    });

    it('shows its own empty state with a clear action when nothing matches (D3)', async () => {
      mockTree();
      const router = renderPage(undefined, ['owner', 'admin'], '?q=zzz');
      expect(await screen.findByText('Sin resultados para «zzz»')).toBeTruthy();
      expect(screen.getByText(spanText('0 resultados de 3 features'))).toBeTruthy();
      expect(screen.queryByRole('tree')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
      expect(router.state.location.search).toBe('');
      expect(await screen.findByRole('tree')).toBeTruthy();
    });

    it('folds accents and case in titles (D4)', async () => {
      const forest: TreeNode[] = [
        { ...FOREST[0]!, children: [{ ...FOREST[0]!.children[0]!, title: 'Árbol de features y su buscador' }, FOREST[0]!.children[1]!] },
      ];
      vi.spyOn(client, 'getTree').mockResolvedValue({ forest });
      vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
      vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
      renderPage(undefined, ['owner', 'admin'], '?q=arbol');
      expect(await screen.findByRole('treeitem', { name: /FR-001/ })).toBeTruthy();
      expect(screen.queryByRole('treeitem', { name: /FR-002/ })).toBeNull();
    });

    it('does not move the selection when filtering (D5)', async () => {
      mockTree();
      renderPage();
      await screen.findByRole('treeitem', { name: /FR-002/ });
      await userEvent.type(screen.getByLabelText('Buscar por id o título'), 'Importador');

      expect(await screen.findByText(/Mercado/, { selector: 'h1, h2, h3' })).toBeTruthy();
      expect(screen.getByRole('treeitem', { name: /MRD-001/ }).ariaSelected).toBe('true');
    });
  });

  it('mantiene «N resultados» igual a las filas visibles al tipear sobre un filtro ya activo (rework WO-678)', async () => {
    // D2: la N del header siempre es el número de filas visibles, aunque el término se tipee sobre un filtro ya activo.
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: DEEP_FOREST });
    vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
    vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);
    renderPage(undefined, ['owner', 'admin'], '?q=churn');
    await screen.findByRole('treeitem', { name: /FR-030/ });
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '3 resultados de 6 features')).toBeTruthy();

    const field = screen.getByLabelText('Buscar por id o título');
    await userEvent.clear(field);
    await userEvent.type(field, 'reporte', { delay: 20 });

    expect(await screen.findByRole('treeitem', { name: /FR-031/ })).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '3 resultados de 6 features')).toBeTruthy();
    const rows = screen.getAllByRole('treeitem');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => /(MRD|PRD|FR)-\d+/.exec(row.textContent ?? '')?.[0])).toEqual(['MRD-002', 'PRD-021', 'FR-031']);
    expect(screen.getByRole('treeitem', { name: /MRD-002/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('treeitem', { name: /FR-030/ })).toBeNull();
  });

  it('conserva ?q= al clickear una fila (rework WO-678, D1)', async () => {
    mockTree();
    const router = renderPage(undefined, ['owner', 'admin'], '?q=FR-001');
    await userEvent.click(await screen.findByRole('treeitem', { name: /FR-001/ }));

    expect(router.state.location.pathname).toBe('/o/acme/p/web/arbol/FR-001');
    expect(router.state.location.search).toBe('?q=FR-001');
    expect((screen.getByLabelText('Buscar por id o título') as HTMLInputElement).value).toBe('FR-001');
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '2 resultados de 3 features')).toBeTruthy();
    expect(screen.queryByRole('treeitem', { name: /FR-002/ })).toBeNull();
  });

  it('conserva ?q= al seleccionar con Enter (rework WO-678, D1)', async () => {
    mockTree();
    const router = renderPage(undefined, ['owner', 'admin'], '?q=FR-001');
    const root = await screen.findByRole('treeitem', { name: /MRD-001/ });
    root.focus();
    await userEvent.keyboard('{Enter}');

    expect(router.state.location.search).toBe('?q=FR-001');
    expect((screen.getByLabelText('Buscar por id o título') as HTMLInputElement).value).toBe('FR-001');
  });

  it('conserva ?sinCodigo=1 al clickear una fila (rework WO-678)', async () => {
    mockTree();
    vi.spyOn(client, 'getMetrics').mockResolvedValue(ONE_ORPHAN);
    const router = renderPage(undefined, ['owner', 'admin'], '?sinCodigo=1');
    await userEvent.click(await screen.findByRole('treeitem', { name: /FR-002/ }));

    expect(router.state.location.pathname).toBe('/o/acme/p/web/arbol/FR-002');
    expect(router.state.location.search).toBe('?sinCodigo=1');
    expect(screen.getByRole('button', { name: 'Sin código (1)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the "Sin código" chip filters the tree to the orphan features and announces the count (SDD-079)', async () => {
    mockTree();
    vi.spyOn(client, 'getMetrics').mockResolvedValue(ONE_ORPHAN);

    const router = renderPage();

    const chip = await screen.findByRole('button', { name: 'Sin código (1)' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    const row = screen.getByRole('treeitem', { name: /FR-002/ });
    expect(within(row).getByText('Sin código')).toBeTruthy();

    await userEvent.click(chip);

    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(router.state.location.search).toBe('?sinCodigo=1');
    expect(screen.queryByRole('treeitem', { name: /FR-001/ })).toBeNull();
    expect(screen.queryByRole('treeitem', { name: /MRD-001/ })).toBeNull();
    expect(screen.getAllByRole('treeitem')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('1 feature sin código');
  });

  it('starts filtered when the url already carries ?sinCodigo=1 (drill-down from the Planta)', async () => {
    mockTree();
    vi.spyOn(client, 'getMetrics').mockResolvedValue(ONE_ORPHAN);

    renderPage(undefined, ['owner', 'admin'], '?sinCodigo=1');

    const chip = await screen.findByRole('button', { name: 'Sin código (1)' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('treeitem', { name: /FR-001/ })).toBeNull();
    expect(screen.getByRole('treeitem', { name: /FR-002/ })).toBeTruthy();
  });

  it('offers no chip when there are no orphan features', async () => {
    mockTree();

    renderPage();

    await screen.findByRole('tree', { name: /árbol de features/i });
    expect(screen.queryByRole('button', { name: /Sin código/ })).toBeNull();
  });

  it('does not filter, and shows no chip, when ?sinCodigo=1 arrives with an empty orphan list', async () => {
    mockTree();

    renderPage(undefined, ['owner', 'admin'], '?sinCodigo=1');

    expect(await screen.findByRole('treeitem', { name: /FR-001/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /MRD-001/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sin código/ })).toBeNull();
  });

  it('offers no chip and keeps the tree whole when the server predates the field (SDD-079, separate deploys)', async () => {
    mockTree();
    vi.spyOn(client, 'getMetrics').mockResolvedValue({
      ...METRICS,
      traceability: { featuresTotal: 3, featuresTraced: 3, featurePercent: 100, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0, commitPercent: null },
    } as unknown as SuccessMetricsDto);

    renderPage(undefined, ['owner', 'admin'], '?sinCodigo=1');

    expect(await screen.findByRole('treeitem', { name: /FR-001/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /MRD-001/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sin código/ })).toBeNull();
  });

  describe('el encabezado sigue el filtro activo (WO-750, SDD-105 D3)', () => {
    const spanText = (text: string) => (_: string, element: Element | null) => element?.tagName === 'SPAN' && element.textContent === text;

    it('con el chip activo describe el conjunto filtrado, con el total como denominador', async () => {
      mockTree();
      vi.spyOn(client, 'getMetrics').mockResolvedValue(TWO_ORPHANS);

      renderPage(undefined, ['owner', 'admin'], '?sinCodigo=1');

      // El árbol monta las 2 huérfanas y el encabezado habla de esas filas, no del proyecto entero.
      await screen.findByRole('treeitem', { name: /FR-001/ });
      expect(screen.getAllByRole('treeitem')).toHaveLength(2);
      expect(screen.getByText(spanText('2 resultados de 3 features'))).toBeTruthy();
      expect(screen.queryByText(spanText('3 features, 1 cerradas'))).toBeNull();
    });

    it('al limpiar el chip vuelve al conteo de siempre', async () => {
      mockTree();
      vi.spyOn(client, 'getMetrics').mockResolvedValue(TWO_ORPHANS);

      renderPage();
      const chip = await screen.findByRole('button', { name: 'Sin código (2)' });
      expect(await screen.findByText(spanText('3 features, 1 cerradas'))).toBeTruthy();

      await userEvent.click(chip);
      expect(screen.getByText(spanText('2 resultados de 3 features'))).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: 'Sin código (2)' }));
      expect(screen.getByText(spanText('3 features, 1 cerradas'))).toBeTruthy();
      expect(screen.getAllByRole('treeitem')).toHaveLength(3);
    });

    it('con ?q= conserva el contrato de SDD-083', async () => {
      vi.spyOn(client, 'getTree').mockResolvedValue({ forest: DEEP_FOREST });
      vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
      vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

      renderPage(undefined, ['owner', 'admin'], '?q=reporte');

      // Sin chip (METRICS no trae huérfanas) el encabezado sigue contando el resultado de la búsqueda.
      await screen.findByRole('treeitem', { name: /FR-031/ });
      expect(screen.queryByRole('button', { name: /Sin código/ })).toBeNull();
      expect(screen.getByText(spanText('3 resultados de 6 features'))).toBeTruthy();
      expect(screen.queryByText(spanText('6 features, 0 cerradas'))).toBeNull();
    });
  });

  describe('el panel deja de montarse entero (WO-749, SDD-105)', () => {
    it('monta 25 órdenes como máximo, las más recientes, y dice el total con su enlace a la cola (D1/D2)', async () => {
      vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
      vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
      vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(branchWithOrders(40));
      vi.spyOn(client, 'listCommits').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(client, 'listCodeRefs').mockResolvedValue([]);

      renderPage('FR-001');

      const table = await screen.findByRole('table', { name: /órdenes de FR-001/i });
      // 1 fila de encabezado + 25 órdenes: las 40 nunca se montan.
      expect(within(table).getAllByRole('row')).toHaveLength(26);
      // Sin fechas el orden es por id descendente: WO-139..WO-115 quedan, WO-114 y anteriores no.
      expect(within(table).getByRole('row', { name: /WO-115/ })).toBeTruthy();
      expect(within(table).queryByRole('row', { name: /WO-114\b/ })).toBeNull();

      expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === 'Mostrando las 25 órdenes más recientes de 40')).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Ver las 40 órdenes en la cola' });
      expect(link.getAttribute('href')).toBe('/o/acme/p/web/ordenes');
    });

    it('ordena por fecha de commit descendente y, sin fecha, por id descendente (D1)', async () => {
      vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
      vi.spyOn(client, 'getNode').mockImplementation((_o, _p, ref) => Promise.resolve(nodeDetailFor(ref)));
      vi.spyOn(client, 'getFeatureBranch').mockResolvedValue({
        nodes: [
          { ref: 'SDD-005', label: 'Blueprint', kind: 'SDD', title: 'Diseño', status: 'published' },
          { ref: 'WO-100', label: 'WorkOrder', kind: 'WO', title: 'Vieja', status: 'done' },
          { ref: 'WO-101', label: 'WorkOrder', kind: 'WO', title: 'Sin commit', status: 'pending' },
          { ref: 'WO-102', label: 'WorkOrder', kind: 'WO', title: 'Nueva', status: 'done' },
          { ref: 'WO-103', label: 'WorkOrder', kind: 'WO', title: 'Sin commit tampoco', status: 'pending' },
          { ref: 'WO-104', label: 'WorkOrder', kind: 'WO', title: 'Media', status: 'done' },
        ],
        edges: [],
      });
      vi.spyOn(client, 'listCommits').mockResolvedValue({
        items: [
          { sha: 'aaa1111', subject: 'x', author: 'me', date: '2026-01-01', refs: ['WO-100'], files: [], trust: 'baseline' },
          { sha: 'ccc3333', subject: 'x', author: 'me', date: '2026-03-01', refs: ['WO-102'], files: [], trust: 'baseline' },
          { sha: 'bbb2222', subject: 'x', author: 'me', date: '2026-02-01', refs: ['WO-104'], files: [], trust: 'baseline' },
        ],
        nextCursor: null,
      });
      vi.spyOn(client, 'listCodeRefs').mockResolvedValue([]);

      renderPage('FR-001');

      const table = await screen.findByRole('table', { name: /órdenes de FR-001/i });
      await waitFor(() =>
        expect(within(table).getAllByRole('row').slice(1).map((row) => /WO-\d+/.exec(row.textContent ?? '')?.[0])).toEqual([
          'WO-102',
          'WO-104',
          'WO-100',
          'WO-103',
          'WO-101',
        ]),
      );
      // Con 5 órdenes no hay recorte: la línea del tope no aparece.
      expect(screen.queryByText(/Mostrando las/)).toBeNull();
    });

    it('mientras carga el panel muestra el texto de lo que carga, además del bloque gris (D4)', async () => {
      vi.spyOn(client, 'getTree').mockResolvedValue({ forest: FOREST });
      vi.spyOn(client, 'getNode').mockImplementation(() => new Promise<never>(() => {}));
      vi.spyOn(client, 'getFeatureBranch').mockResolvedValue(BRANCH);

      renderPage('FR-001');

      await screen.findByRole('tree', { name: /árbol de features/i });
      const status = await screen.findByRole('status');
      expect(status.textContent).toBe('Cargando las órdenes y la trazabilidad de FR-001…');
      expect(document.querySelector('[data-skeleton-bar]')).toBeTruthy();
    });

    it('mientras carga el árbol muestra el texto de lo que carga, además del bloque gris (D4)', async () => {
      vi.spyOn(client, 'getTree').mockImplementation(() => new Promise<never>(() => {}));

      renderPage();

      const status = await screen.findByRole('status');
      expect(status.textContent).toBe('Cargando el árbol de features…');
      expect(document.querySelector('[data-skeleton-bar]')).toBeTruthy();
    });
  });
});
