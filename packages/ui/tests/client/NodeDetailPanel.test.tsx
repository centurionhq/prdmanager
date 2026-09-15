import type { NodeDetail } from '@prdm/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NodeDetailPanel } from '../../src/components/NodeDetailPanel';
import { SelectionProvider, useSelection } from '../../src/state/selection';

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
    const fetchNode = vi.fn();
    render(
      <SelectionProvider>
        <NodeDetailPanel fetchNode={fetchNode} />
      </SelectionProvider>,
    );
    expect(screen.getByText(/Seleccioná un nodo/)).toBeTruthy();
    expect(fetchNode).not.toHaveBeenCalled();
  });

  it('fetches and renders the selected node once select() is called', async () => {
    const fetchNode = vi.fn().mockResolvedValue(detail());

    render(
      <SelectionProvider>
        <Selector id="PRD-004" />
        <NodeDetailPanel fetchNode={fetchNode} />
      </SelectionProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'select PRD-004' }));

    await waitFor(() => expect(screen.getByText('PRD-004')).toBeTruthy());
    expect(screen.getByText('Explorador web del Feature Tree y del drift')).toBeTruthy();
    expect(screen.getByText('approved')).toBeTruthy();
    expect(fetchNode).toHaveBeenCalledWith('PRD-004');
  });

  it('renders relation buttons and selecting one navigates to that node', async () => {
    const fetchNode = vi.fn(async (id: string) =>
      id === 'PRD-004' ? detail({}, [{ type: 'EVOLVES_FROM', direction: 'out', ref: 'PRD-002', title: 'x', props: {} }]) : detail({ id: 'PRD-002' }),
    );

    render(
      <SelectionProvider>
        <Selector id="PRD-004" />
        <NodeDetailPanel fetchNode={fetchNode} />
      </SelectionProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'select PRD-004' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'PRD-002' })).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'PRD-002' }));
    await waitFor(() => expect(fetchNode).toHaveBeenCalledWith('PRD-002'));
  });

  it('shows an error state with a working retry when the fetch fails', async () => {
    const fetchNode = vi.fn().mockRejectedValueOnce(new Error('offline'));

    render(
      <SelectionProvider>
        <Selector id="PRD-004" />
        <NodeDetailPanel fetchNode={fetchNode} />
      </SelectionProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'select PRD-004' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fetchNode.mockResolvedValueOnce(detail());
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    });

    await waitFor(() => expect(screen.getByText('PRD-004')).toBeTruthy());
  });
});
