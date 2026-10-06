import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DriftIssueDto } from '@prdm/contracts';
import { DriftIssuesList } from '../../src/routes/drift/DriftIssuesList.js';

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

describe('DriftIssuesList', () => {
  it('shows the humanized headline instead of the raw engine message', () => {
    render(<DriftIssuesList issues={[fakeIssue()]} />);

    expect(screen.getByText(/no coincide con/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('is out of sync with');
    expect(document.body.textContent).not.toContain('(code_changed)');
  });

  it('shows the suggested action without hover', () => {
    render(<DriftIssuesList issues={[fakeIssue()]} />);

    expect(screen.getByText(/Qué hacer:/)).toBeTruthy();
    expect(screen.getByText(/Actualizá el código/)).toBeTruthy();
  });

  it('keeps the path and the blueprint id rendered as monospace ids', () => {
    render(<DriftIssuesList issues={[fakeIssue()]} />);

    expect(screen.getByText('pkg/a.ts').className).toBe('id');
    expect(screen.getAllByText('SDD-008').some((el) => el.className === 'id')).toBe(true);
  });

  it('falls back to the raw message with no action for an unknown kind', () => {
    const raw = 'brand new engine kind happened';
    render(<DriftIssuesList issues={[fakeIssue({ kind: 'engine_v2_novel', message: raw, blueprintId: null, target: undefined })]} />);

    expect(screen.getByText(raw)).toBeTruthy();
    expect(screen.queryByText(/Qué hacer:/)).toBeNull();
  });

  it('attaches tooltips for the reason and the blueprint, readable without hover', () => {
    render(<DriftIssuesList issues={[fakeIssue()]} />);

    const tips = screen.getAllByRole('tooltip').map((el) => el.textContent ?? '');
    expect(tips.some((t) => t.includes('Razón detectada'))).toBe(true);
    expect(tips.some((t) => /blueprint/i.test(t))).toBe(true);
  });
});
