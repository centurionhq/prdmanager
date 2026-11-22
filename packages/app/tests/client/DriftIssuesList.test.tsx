import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DriftIssueDto } from '@prdm/contracts';
import { DriftIssuesList } from '../../src/routes/drift/DriftIssuesList.js';
import { acknowledgeableTargets } from '../../src/routes/drift/drift-groups.js';

function fakeIssue(overrides: Partial<DriftIssueDto> = {}): DriftIssueDto {
  return {
    kind: 'code_out_of_sync',
    severity: 'error',
    nodeId: 'SDD-008',
    target: 'pkg/a.ts',
    message: 'pkg/a.ts is out of sync with SDD-008 (code_changed)',
    id: 'a1b2c3',
    featureIds: ['FR-002'],
    blueprintId: 'SDD-008',
    station: 'construccion',
    detectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The list is presentational: the screen owns the targets, the permission and the modal. */
function renderList(issues: readonly DriftIssueDto[]): void {
  render(
    <DriftIssuesList
      issues={issues}
      ackTargets={[]}
      canAcknowledge={false}
      onAcknowledgeRequest={() => undefined}
    />,
  );
}

describe('DriftIssuesList', () => {
  it('shows the humanized headline instead of the raw engine message', () => {
    renderList([fakeIssue()]);

    expect(screen.getByText(/no coincide con/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('is out of sync with');
    expect(document.body.textContent).not.toContain('(code_changed)');
  });

  it('shows the suggested action without hover', () => {
    renderList([fakeIssue()]);

    expect(screen.getByText(/Qué hacer:/)).toBeTruthy();
    expect(screen.getByText(/Actualizá el código/)).toBeTruthy();
  });

  it('keeps the path and the blueprint id rendered as monospace ids', () => {
    renderList([fakeIssue()]);

    expect(screen.getByText('pkg/a.ts').className).toBe('id');
    expect(screen.getAllByText('SDD-008').some((el) => el.className === 'id')).toBe(true);
  });

  it('shows the Spanish copy of a landed_but_open issue and not the raw engine sentence', () => {
    renderList([
      fakeIssue({
        kind: 'landed_but_open',
        severity: 'warning',
        nodeId: 'WO-625',
        target: '9def4e20893f6116ae195acbdf4d07380bc3018c',
        blueprintId: null,
        message:
          'WO-625 is in_progress but commit 9def4e20893f6116ae195acbdf4d07380bc3018c already references it (Refs: WO-625)',
      }),
    ]);

    expect(screen.getByText(/Ya aterrizada/)).toBeTruthy();
    expect(screen.getByText(/Completala con ese sha/)).toBeTruthy();
    // SDD-107 D2: the sha is a literal id inside the row (Drift.dc.html:223 draws it as `<span class="id">`).
    expect(screen.getByText('9def4e2').className).toBe('id');
    expect(document.body.textContent).not.toContain('already references it');
  });

  it('titles the landed_but_open group in Spanish, never with the raw engine kind', () => {
    renderList([
      fakeIssue({
        kind: 'landed_but_open',
        severity: 'warning',
        nodeId: 'WO-625',
        target: '9def4e20893f6116ae195acbdf4d07380bc3018c',
        blueprintId: null,
        message:
          'WO-625 is in_progress but commit 9def4e20893f6116ae195acbdf4d07380bc3018c already references it (Refs: WO-625)',
      }),
    ]);

    const header = screen.getByText('Órdenes ya aterrizadas');
    expect(header.closest('summary')).toBeTruthy();
    expect(document.body.textContent).not.toContain('landed_but_open');
  });

  it('falls back to the raw message with no action for an unknown kind', () => {
    const raw = 'brand new engine kind happened';
    renderList([fakeIssue({ kind: 'engine_v2_novel', message: raw, blueprintId: null, target: undefined })]);

    expect(screen.getByText(raw)).toBeTruthy();
    expect(screen.queryByText(/Qué hacer:/)).toBeNull();
  });

  it('attaches tooltips for the reason and the blueprint, readable without hover', () => {
    renderList([fakeIssue()]);

    const tips = screen.getAllByRole('tooltip').map((el) => el.textContent ?? '');
    expect(tips.some((t) => t.includes('Razón detectada'))).toBe(true);
    expect(tips.some((t) => /blueprint/i.test(t))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// SDD-111 / WO-767 — the list offers the acknowledge where it is real: from the row and from the subgroup,
// always on the DOCUMENT (never on a single issue), and never in a place the server would reject.
// ---------------------------------------------------------------------------------------------------

function renderWithActions(issues: readonly DriftIssueDto[]): ReturnType<typeof vi.fn> {
  const onAcknowledgeRequest = vi.fn();
  render(
    <DriftIssuesList
      issues={issues}
      ackTargets={acknowledgeableTargets(issues)}
      canAcknowledge
      onAcknowledgeRequest={onAcknowledgeRequest}
    />,
  );
  return onAcknowledgeRequest;
}

function subgroupDetails(): HTMLDetailsElement {
  const details = document.querySelector<HTMLDetailsElement>('details details');
  if (!details) throw new Error('no subgroup <details>');
  return details;
}

describe('DriftIssuesList · reconocer por documento (SDD-111)', () => {
  it('opens the request from a row on its document, never on one issue', async () => {
    const requested = renderWithActions([
      fakeIssue({ id: 'r1', blueprintId: 'SDD-008', target: 'pkg/a.ts', message: 'pkg/a.ts is out of sync with SDD-008' }),
      fakeIssue({ id: 'r2', blueprintId: 'SDD-008', target: 'pkg/b.ts', message: 'pkg/b.ts is out of sync with SDD-008' }),
    ]);

    // The document carries two issues, so both rows say two: acknowledging moves the document, not the row.
    const rowButtons = screen.getAllByRole('button', { name: 'Reconocer SDD-008: cubre 2 issues' });
    expect(rowButtons).toHaveLength(2);
    await userEvent.click(rowButtons[1]!);

    expect(requested).toHaveBeenCalledWith('SDD-008');
  });

  it('opens the request from the subgroup with every issue of the document, across kinds', async () => {
    const requested = renderWithActions([
      fakeIssue({ id: 'r1', blueprintId: 'SDD-008', target: 'pkg/a.ts', message: 'pkg/a.ts is out of sync with SDD-008' }),
      fakeIssue({
        id: 'r2',
        kind: 'lifecycle_violation',
        blueprintId: 'SDD-008',
        nodeId: 'SDD-008',
        target: undefined,
        message: 'SDD-008 is active but its children are draft',
      }),
    ]);

    const subgroupAction = within(subgroupDetails()).getByRole('button', { name: 'Reconocer los 2 issues de SDD-008' });
    expect(subgroupAction.textContent).toBe('Reconocer los 2 issues');
    await userEvent.click(subgroupAction);

    expect(requested).toHaveBeenCalledWith('SDD-008');
  });

  it('the subgroup action does not toggle the <details> it lives in', async () => {
    const requested = renderWithActions([fakeIssue({ blueprintId: 'SDD-008' })]);
    const subgroup = subgroupDetails();
    expect(subgroup.open).toBe(true);

    await userEvent.click(within(subgroup).getByRole('button', { name: 'Reconocer el issue de SDD-008' }));

    expect(requested).toHaveBeenCalledWith('SDD-008');
    expect(subgroup.open).toBe(true);
  });

  it('offers no action on a work order row and says why, without inventing a target', () => {
    renderWithActions([
      fakeIssue({
        id: 'r1',
        kind: 'landed_but_open',
        severity: 'warning',
        blueprintId: null,
        nodeId: 'WO-625',
        target: '9def4e20893f6116ae195acbdf4d07380bc3018c',
        message: 'WO-625 is in_progress but commit 9def4e20893f6116ae195acbdf4d07380bc3018c already references it (Refs: WO-625)',
      }),
    ]);

    expect(screen.queryByRole('button', { name: /^Reconocer WO-/ })).toBeNull();
    const row = screen.getByText(/Ya aterrizada/).closest('li');
    expect(row?.getAttribute('title')).toMatch(/no se reconoce sola/);
  });

  it('renders no action at all without the permission', () => {
    render(
      <DriftIssuesList
        issues={[fakeIssue({ blueprintId: 'SDD-008' })]}
        ackTargets={acknowledgeableTargets([fakeIssue({ blueprintId: 'SDD-008' })])}
        canAcknowledge={false}
        onAcknowledgeRequest={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Reconocer/ })).toBeNull();
    expect(screen.getByText(/no coincide con/).closest('li')?.getAttribute('title')).toBeNull();
  });
});
