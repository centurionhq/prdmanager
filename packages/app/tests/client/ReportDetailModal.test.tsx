import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriftIssueDto, DriftReportDetailDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { ReportDetailModal } from '../../src/routes/drift/ReportDetailModal.js';

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

function fakeDetail(issues: DriftIssueDto[]): DriftReportDetailDto {
  return {
    id: 'r1',
    mode: 'preview',
    headSha: 'a'.repeat(40),
    branch: 'feature/x',
    tokenName: 'ana-personal',
    issueCount: issues.length,
    hasBlockingIssues: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    issues,
  };
}

async function renderModal(issues: DriftIssueDto[]): Promise<void> {
  vi.spyOn(client, 'getDriftReportDetail').mockResolvedValue(fakeDetail(issues));
  render(<ReportDetailModal orgSlug="acme" projectSlug="web" reportId="r1" onClose={() => {}} />);
  await screen.findByRole('dialog', { name: 'Detalle del reporte' });
  await screen.findByText(/ana-personal/);
}

describe('ReportDetailModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the humanized sentence instead of the raw message', async () => {
    await renderModal([fakeIssue()]);

    expect(screen.getByText(/no coincide con/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('is out of sync with');
    expect(document.body.textContent).not.toContain('(code_changed)');
  });

  it('keeps the path and blueprint id as mono tokens', async () => {
    await renderModal([fakeIssue()]);

    expect(screen.getByText('pkg/a.ts').className).toBe('id');
    expect(screen.getAllByText('SDD-008').some((el) => el.className === 'id')).toBe(true);
  });

  it('shows the suggested action on a second line', async () => {
    await renderModal([fakeIssue()]);

    expect(screen.getByText(/Qué hacer:/)).toBeTruthy();
    expect(screen.getByText(/Actualizá el código/)).toBeTruthy();
  });

  it('renders glossary tooltips readable without hover', async () => {
    await renderModal([fakeIssue()]);

    const tips = screen.getAllByRole('tooltip').map((el) => el.textContent ?? '');
    expect(tips.some((t) => t.includes('Razón detectada'))).toBe(true);
    expect(tips.some((t) => /blueprint/i.test(t))).toBe(true);
  });

  it('falls back to the raw message with no action for an unknown kind', async () => {
    const raw = 'engine v2 found something novel';
    await renderModal([fakeIssue({ kind: 'engine_v2_novel' as DriftIssueDto['kind'], blueprintId: null, target: undefined, message: raw })]);

    expect(screen.getByText(raw)).toBeTruthy();
    expect(screen.queryByText(/Qué hacer:/)).toBeNull();
  });
});
