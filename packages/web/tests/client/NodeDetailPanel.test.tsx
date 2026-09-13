import type { NodeDetail } from '@prdm/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getNode } from '../../src/client/api/client';
import { NodeDetailPanel } from '../../src/client/components/NodeDetailPanel';
import { SelectionProvider, useSelection } from '../../src/client/state/selection';

vi.mock('../../src/client/api/client', () => ({ getNode: vi.fn() }));

const mockGetNode = vi.mocked(getNode);

function detail(overrides: Partial<NodeDetail['node']> = {}, links: NodeDetail['links'] = []): NodeDetail {
  return {
    node: {
      id: 'PRD-004',
      label: 'Feature',
      kind: 'PRD',
      title: 'Explorador web del Feature Tree y del drift',
      status: 'approved',
      body: '',
      tags: ['web-ui'],
      source_path: 'docs/prd/PRD-004-explorador-web.md',
      created_at: '2026-09-13',
      ...overrides,
    },
    links,
  };
}

function Selector({ id }: { id: string }): ReactElement {
  const { select } = useSelection();
  return (
    <button type="button" onClick={() => select(id)}>
      select {id}
    </button>
  );
}

describe('NodeDetailPanel', () => {
  it('shows a placeholder before anything is selected', () => {
    render(
      <SelectionProvider>
        <NodeDetailPanel />
      </SelectionProvider>,
    );
    expect(screen.getByText(/Seleccioná un nodo/)).toBeTruthy();
    expect(mockGetNode).not.toHaveBeenCalled();
  });

  it('fetches and renders the selected node once select() is called', async () => {
    mockGetNode.mockResolvedValue(detail());

    render(
      <SelectionProvider>
        <Selector id="PRD-004" />
        <NodeDetailPanel />
      </SelectionProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'select PRD-004' }));

    await waitFor(() => expect(screen.getByText('PRD-004')).toBeTruthy());
    expect(screen.getByText('Explorador web del Feature Tree y del drift')).toBeTruthy();
    expect(screen.getByText('approved')).toBeTruthy();
    expect(mockGetNode).toHaveBeenCalledWith('PRD-004');
  });

  it('renders relation buttons and selecting one navigates to that node', async () => {
    mockGetNode.mockImplementation(async (id: string) =>
      id === 'PRD-004' ? detail({}, [{ type: 'EVOLVES_FROM', direction: 'out', ref: 'PRD-002', title: 'x', props: {} }]) : detail({ id: 'PRD-002' }),
    );

    render(
      <SelectionProvider>
        <Selector id="PRD-004" />
        <NodeDetailPanel />
      </SelectionProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'select PRD-004' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'PRD-002' })).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'PRD-002' }));
    await waitFor(() => expect(mockGetNode).toHaveBeenCalledWith('PRD-002'));
  });

  it('shows an error state with a working retry when the fetch fails', async () => {
    mockGetNode.mockRejectedValueOnce(new Error('offline'));

    render(
      <SelectionProvider>
        <Selector id="PRD-004" />
        <NodeDetailPanel />
      </SelectionProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'select PRD-004' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    mockGetNode.mockResolvedValueOnce(detail());
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    });

    await waitFor(() => expect(screen.getByText('PRD-004')).toBeTruthy());
  });
});
