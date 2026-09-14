import type { TreeNode } from '@prdm/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TreeView } from '../../src/components/TreeView';
import { SelectionProvider, useSelection } from '../../src/state/selection';

function node(ref: string, label: string, children: TreeNode[] = []): TreeNode {
  return { ref, label, kind: label, title: `${ref} title`, status: 'approved', via: null, edgeStatus: null, reviewNeeded: false, repeated: false, children };
}

function SelectedProbe(): ReactElement {
  const { selectedId } = useSelection();
  return <span data-testid="selected">{selectedId ?? 'none'}</span>;
}

function ExternalSelector({ id }: { id: string }): ReactElement {
  const { select } = useSelection();
  return (
    <button type="button" onClick={() => select(id)}>
      select {id} externally
    </button>
  );
}

const forest: TreeNode[] = [node('PRD-004', 'Feature', [node('SDD-005', 'Blueprint', [node('WO-070', 'WorkOrder')])])];

describe('TreeView', () => {
  it('renders every node in the forest, expanded by default', () => {
    render(
      <SelectionProvider>
        <TreeView forest={forest} driftIds={new Set()} />
      </SelectionProvider>,
    );

    expect(screen.getByRole('treeitem', { name: /PRD-004/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /SDD-005/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /WO-070/ })).toBeTruthy();
  });

  it('clicking a tree item selects it', async () => {
    render(
      <SelectionProvider>
        <TreeView forest={forest} driftIds={new Set()} />
        <SelectedProbe />
      </SelectionProvider>,
    );

    await userEvent.click(screen.getByRole('treeitem', { name: /WO-070/ }));

    expect(screen.getByTestId('selected').textContent).toBe('WO-070');
  });

  it('marks a node id present in driftIds as aria-selected=false but visibly flagged via data-drift', () => {
    render(
      <SelectionProvider>
        <TreeView forest={forest} driftIds={new Set(['WO-070'])} />
      </SelectionProvider>,
    );

    const item = screen.getByRole('treeitem', { name: /WO-070/ });
    expect(item.dataset.drift).toBe('true');
  });

  it('ArrowDown moves the roving tabindex (and selection) to the next visible row', async () => {
    render(
      <SelectionProvider>
        <TreeView forest={forest} driftIds={new Set()} />
        <SelectedProbe />
      </SelectionProvider>,
    );

    const root = screen.getByRole('treeitem', { name: /PRD-004/ });
    root.focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByTestId('selected').textContent).toBe('SDD-005');
  });

  it('Home/End jump to the first and last visible rows', async () => {
    render(
      <SelectionProvider>
        <TreeView forest={forest} driftIds={new Set()} />
        <SelectedProbe />
      </SelectionProvider>,
    );

    screen.getByRole('treeitem', { name: /WO-070/ }).focus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByTestId('selected').textContent).toBe('PRD-004');

    await userEvent.keyboard('{End}');
    expect(screen.getByTestId('selected').textContent).toBe('WO-070');
  });

  it('auto-expands the ancestors of a selection made from outside the tree, even under a manually collapsed branch', async () => {
    render(
      <SelectionProvider>
        <TreeView forest={forest} driftIds={new Set()} />
        <ExternalSelector id="WO-070" />
      </SelectionProvider>,
    );

    const root = screen.getByRole('treeitem', { name: /PRD-004/ });
    root.focus();
    await userEvent.keyboard('{ArrowLeft}'); // collapses PRD-004, hiding SDD-005/WO-070
    expect(screen.queryByRole('treeitem', { name: /WO-070/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'select WO-070 externally' }));

    expect(screen.getByRole('treeitem', { name: /WO-070/ })).toBeTruthy();
  });
});
