import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { SelectionProvider, useSelection } from '../../src/state/selection';

function Probe(): ReactElement {
  const { selectedId, select } = useSelection();
  return (
    <div>
      <span data-testid="selected">{selectedId ?? 'none'}</span>
      <button type="button" onClick={() => select('FR-001')}>
        select
      </button>
      <button type="button" onClick={() => select(null)}>
        clear
      </button>
    </div>
  );
}

describe('selection state', () => {
  it('starts with no selection', () => {
    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>,
    );

    expect(screen.getByTestId('selected').textContent).toBe('none');
  });

  it('updates the selected id when select() is called', () => {
    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });

    expect(screen.getByTestId('selected').textContent).toBe('FR-001');
  });

  it('shares the same selection across two consumers', () => {
    function TreePanel(): ReactElement {
      const { selectedId } = useSelection();
      return <span data-testid="tree-selected">{selectedId ?? 'none'}</span>;
    }

    render(
      <SelectionProvider>
        <Probe />
        <TreePanel />
      </SelectionProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });

    expect(screen.getByTestId('tree-selected').textContent).toBe('FR-001');
  });

  it('clears the selection back to null', () => {
    render(
      <SelectionProvider>
        <Probe />
      </SelectionProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'clear' }).click();
    });

    expect(screen.getByTestId('selected').textContent).toBe('none');
  });

  it('throws when useSelection() is called outside a SelectionProvider', () => {
    function Orphan(): ReactElement {
      useSelection();
      return null as unknown as ReactElement;
    }

    expect(() => render(<Orphan />)).toThrow(/SelectionProvider/);
  });
});
