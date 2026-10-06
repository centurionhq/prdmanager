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

function fakeDetail(issues: DriftIssueDto[], overrides: Partial<DriftReportDetailDto> = {}): DriftReportDetailDto {
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
    ...overrides,
  };
}

async function renderModal(
  issues: DriftIssueDto[],
  githubRepository: string | null = null,
  overrides: Partial<DriftReportDetailDto> = {},
): Promise<void> {
  vi.spyOn(client, 'getDriftReportDetail').mockResolvedValue(fakeDetail(issues, overrides));
  render(
    <ReportDetailModal orgSlug="acme" projectSlug="web" reportId="r1" githubRepository={githubRepository} onClose={() => {}} />,
  );
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

  // SDD-070 D7 (WO-638): the branch label leads the meta, through the same `branchDisplay` the preview
  // rows use, and only becomes a link when the project knows its own repository.
  it('leads the meta with the branch, sha, token and issue count', async () => {
    await renderModal([fakeIssue()]);

    const meta = screen.getByText(/ana-personal/);
    expect(meta.textContent).toBe('feature/x · aaaaaaaaaaaa · ana-personal · 1 issue');
    expect(screen.queryByRole('link', { name: 'feature/x' })).toBeNull();
  });

  it('links the branch to its GitHub tree when the project has a repository', async () => {
    await renderModal([fakeIssue()], 'centurionhq/prdmanager');

    const link = screen.getByRole('link', { name: 'feature/x' });
    expect(link.getAttribute('href')).toBe('https://github.com/centurionhq/prdmanager/tree/feature/x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('reads a pull_request ref as PR #N and links it to the pull request', async () => {
    await renderModal([fakeIssue()], 'centurionhq/prdmanager', { branch: '32/merge', issueCount: 380 });

    const link = screen.getByRole('link', { name: 'PR #32' });
    expect(link.getAttribute('href')).toBe('https://github.com/centurionhq/prdmanager/pull/32');
    expect(screen.getByText(/ana-personal/).textContent).toBe('PR #32 · aaaaaaaaaaaa · ana-personal · 380 issues');
    expect(screen.queryByText('32/merge')).toBeNull();
  });

  it('keeps the branch as plain text, never a guessed link, without a repository', async () => {
    await renderModal([fakeIssue()], null, { branch: '32/merge' });

    expect(screen.getByText('PR #32')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
