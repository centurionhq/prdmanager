import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeDetail, Subgraph, TreeNode } from '@prdm/core';
import type { CommitDto } from '@prdm/contracts';
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
});
