import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { search } from '../../src/client/api/client';
import { SearchBar } from '../../src/client/components/SearchBar';
import { SelectionProvider, useSelection } from '../../src/client/state/selection';

vi.mock('../../src/client/api/client', () => ({ search: vi.fn() }));

const mockSearch = vi.mocked(search);

function SelectedProbe(): ReactElement {
  const { selectedId } = useSelection();
  return <span data-testid="selected">{selectedId ?? 'none'}</span>;
}

function renderSearchBar() {
  const inputRef = createRef<HTMLInputElement>();
  const utils = render(
    <SelectionProvider>
      <SearchBar inputRef={inputRef} />
      <SelectedProbe />
    </SelectionProvider>,
  );
  return { inputRef, ...utils };
}

describe('SearchBar', () => {
  it('renders no results dropdown before typing anything', () => {
    renderSearchBar();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows matching results once the query resolves', async () => {
    mockSearch.mockResolvedValue([{ id: 'PRD-004', label: 'Feature', title: 'Explorador web', status: 'approved', score: 1 }]);
    renderSearchBar();

    await userEvent.type(screen.getByRole('combobox'), 'explorador');

    await waitFor(() => expect(screen.getByRole('option', { name: /PRD-004/ })).toBeTruthy());
    expect(mockSearch).toHaveBeenCalledWith({ q: 'explorador', limit: 8 });
  });

  it('selecting a result sets the shared selection and clears the query', async () => {
    mockSearch.mockResolvedValue([{ id: 'PRD-004', label: 'Feature', title: 'Explorador web', status: 'approved', score: 1 }]);
    renderSearchBar();

    const input = screen.getByRole('combobox') as HTMLInputElement;
    await userEvent.type(input, 'explorador');
    await waitFor(() => expect(screen.getByRole('option', { name: /PRD-004/ })).toBeTruthy());

    await userEvent.click(screen.getByRole('option', { name: /PRD-004/ }));

    expect(screen.getByTestId('selected').textContent).toBe('PRD-004');
    expect(input.value).toBe('');
  });

  it('shows a "sin resultados" message when the search comes back empty', async () => {
    mockSearch.mockResolvedValue([]);
    renderSearchBar();

    await userEvent.type(screen.getByRole('combobox'), 'zzz');

    await waitFor(() => expect(screen.getByText('Sin resultados')).toBeTruthy());
  });
});
