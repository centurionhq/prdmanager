import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeDetail, Subgraph, TreeNode } from '@prdm/core';
import type { CommitDto, DriftIssueDto } from '@prdm/contracts';
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

function nodeDetailFor(ref: string): NodeDetail {
  if (ref === 'FR-001') {
    return {
      node: { id: 'FR-001', label: 'Feature', kind: 'FR', title: 'Persistencia de borradores', status: 'approved', body: '', tags: [], source_path: '', created_at: null },
      links: [
        { type: 'ARCHITECTS', direction: 'in', ref: 'SDD-005', title: 'SDD-005', props: {} },
        { type: 'JUSTIFIED_BY', direction: 'out', ref: 'FB-004', title: 'FB-004', props: {} },
      ],
    };
  }
  if (ref === 'SDD-005') {
    return {
      node: { id: 'SDD-005', label: 'Blueprint', kind: 'SDD', title: 'Diseño de persistencia', status: 'published', body: '', tags: [], source_path: '', created_at: null },
      links: [
        { type: 'ARCHITECTS', direction: 'out', ref: 'FR-001', title: 'FR-001', props: {} },
        { type: 'IMPLEMENTS', direction: 'in', ref: 'WO-100', title: 'WO-100', props: {} },
      ],
    };
  }
  return {
    node: { id: ref, label: 'Feature', kind: 'MRD', title: 'Mercado: contexto de producto', status: 'approved', body: '', tags: [], source_path: '', created_at: null },
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
  return { node: { id: ref, label: 'Feature', kind: ref.split('-')[0] ?? '', title: ref, status: 'approved', body: '', tags: [], source_path: '', created_at: null }, links: [] };
}

function renderPage(id?: string) {
  const context = makeProjectShellContext('owner', 'admin');
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug',
        element: <Outlet context={context} />,
        children: [{ path: 'arbol/:id?', element: <ProjectGraph /> }],
      },
    ],
    { initialEntries: [`/o/${context.orgSlug}/p/${context.projectSlug}/arbol${id ? `/${id}` : ''}`] },
  );
  render(<RouterProvider router={router} />);
  return context;
}

describe('ProjectGraph (árbol de features)', () => {
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
          node: { id: 'WO-999', label: 'WorkOrder', kind: 'WO', title: 'Orden suelta', status: 'pending', body: '', tags: [], source_path: '', created_at: null },
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
});
