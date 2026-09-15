import type { RefreshReport } from '@prdm/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DriftBanner } from '../../src/components/DriftBanner';
import { SelectionProvider, useSelection } from '../../src/state/selection';

function report(overrides: Partial<RefreshReport> = {}): RefreshReport {
  return { documents: 1, errors: [], issues: [], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: false, ...overrides };
}

function SelectedProbe(): ReactElement {
  const { selectedId } = useSelection();
  return <span data-testid="selected">{selectedId ?? 'none'}</span>;
}

describe('DriftBanner', () => {
  it('reads as synced when there are no issues', () => {
    render(
      <SelectionProvider>
        <DriftBanner report={report()} />
      </SelectionProvider>,
    );
    const banner = screen.getByRole('status');
    expect(banner.dataset.severity).toBe('ok');
    expect(banner.textContent).toContain('Sistema sincronizado');
  });

  it('is amber for warning-only issues and red once any issue is an error', () => {
    const { rerender } = render(
      <SelectionProvider>
        <DriftBanner report={report({ issues: [{ kind: 'impacts_warning', severity: 'warning', nodeId: 'SDD-005', message: 'x' }] })} />
      </SelectionProvider>,
    );
    expect(screen.getByRole('status').dataset.severity).toBe('warning');

    rerender(
      <SelectionProvider>
        <DriftBanner report={report({ issues: [{ kind: 'code_out_of_sync', severity: 'error', nodeId: 'SDD-005', message: 'x' }] })} />
      </SelectionProvider>,
    );
    expect(screen.getByRole('status').dataset.severity).toBe('error');
  });

  it('lists each distinct affected node once, even when several issues point at the same one', () => {
    render(
      <SelectionProvider>
        <DriftBanner
          report={report({
            issues: [
              { kind: 'code_out_of_sync', severity: 'error', nodeId: 'SDD-005', message: 'a' },
              { kind: 'code_out_of_sync', severity: 'error', nodeId: 'SDD-005', message: 'b' },
              { kind: 'code_out_of_sync', severity: 'error', nodeId: 'WO-070', message: 'c' },
            ],
          })}
        />
      </SelectionProvider>,
    );

    expect(screen.getAllByRole('button', { name: 'SDD-005' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'WO-070' })).toBeTruthy();
  });

  it('clicking an issue link selects that node', async () => {
    render(
      <SelectionProvider>
        <DriftBanner report={report({ issues: [{ kind: 'code_out_of_sync', severity: 'error', nodeId: 'SDD-005', message: 'x' }] })} />
        <SelectedProbe />
      </SelectionProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'SDD-005' }));
    expect(screen.getByTestId('selected').textContent).toBe('SDD-005');
  });
});
