/**
 * `PreviewsByBranch` (SDD-070 D2/D4/D5, WO-637): the row is a real button, the delta carries its tone
 * through a CSS-module class, the "vista previa" badge is not a control, and no link is ever rendered
 * inside the row. jsdom applies no CSS module rules, so tone is asserted through the class name the
 * component applies (same convention as `Tooltip.test.tsx`), never through computed styles.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DriftReportSummaryDto } from '@prdm/contracts';
import { PreviewsByBranch } from '../../src/routes/drift/PreviewsByBranch.js';

function fakeReport(overrides: Partial<DriftReportSummaryDto> = {}): DriftReportSummaryDto {
  return {
    id: 'r1',
    mode: 'preview',
    headSha: 'a'.repeat(40),
    branch: '32/merge',
    tokenName: 'ana-personal',
    issueCount: 0,
    hasBlockingIssues: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface RenderOptions {
  readonly previews?: readonly DriftReportSummaryDto[];
  readonly official?: DriftReportSummaryDto | null;
  readonly defaultBranch?: string;
  readonly githubRepository?: string | null;
  readonly onOpenReport?: (reportId: string) => void;
}

function renderPanel({
  previews = [],
  official = null,
  defaultBranch = 'main',
  githubRepository = null,
  onOpenReport = () => {},
}: RenderOptions = {}) {
  return render(
    <PreviewsByBranch
      previews={previews}
      official={official}
      defaultBranch={defaultBranch}
      githubRepository={githubRepository}
      onOpenReport={onOpenReport}
    />,
  );
}

describe('PreviewsByBranch', () => {
  it('shows the current empty state when there are no previews', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Previews por rama' })).toBeTruthy();
    expect(screen.getByText('No hay reportes de vista previa todavía.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders each row as a button whose accessible name says which report it opens', () => {
    renderPanel({ previews: [fakeReport({ id: 'p1', branch: '32/merge', issueCount: 380 })] });

    const row = screen.getByRole('button', { name: 'Ver los 380 issues del reporte de PR #32' });
    expect(row.tagName).toBe('BUTTON');
    expect(screen.getByText('PR #32')).toBeTruthy();
  });

  it('opens the report by click, Enter and Space', async () => {
    const onOpenReport = vi.fn();
    renderPanel({ previews: [fakeReport({ id: 'p1', branch: '32/merge', issueCount: 380 })], onOpenReport });

    const row = screen.getByRole('button', { name: 'Ver los 380 issues del reporte de PR #32' });

    await userEvent.click(row);
    expect(onOpenReport).toHaveBeenCalledWith('p1');

    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenReport).toHaveBeenCalledTimes(2);

    await userEvent.keyboard(' ');
    expect(onOpenReport).toHaveBeenCalledTimes(3);
    expect(onOpenReport).toHaveBeenLastCalledWith('p1');
  });

  it('does not expose the "vista previa" badge as a control', () => {
    renderPanel({ previews: [fakeReport({ branch: 'feat/x' })] });

    expect(screen.getByText('vista previa')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /vista previa/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /vista previa/i })).toBeNull();
  });

  it('reads <N>/merge as PR #<N>', () => {
    renderPanel({ previews: [fakeReport({ branch: '32/merge' })] });

    expect(screen.getByText('PR #32')).toBeTruthy();
    expect(screen.queryByText('32/merge')).toBeNull();
  });

  it('shows the delta against the default branch with its tone', () => {
    renderPanel({
      official: fakeReport({ id: 'official', mode: 'baseline', branch: 'main', issueCount: 226 }),
      previews: [
        fakeReport({ id: 'p1', branch: '32/merge', issueCount: 380 }),
        fakeReport({ id: 'p2', branch: 'feat/mejora', issueCount: 142 }),
        fakeReport({ id: 'p3', branch: 'feat/igual', issueCount: 226 }),
        fakeReport({ id: 'p4', branch: 'feat/limpia', issueCount: 0 }),
      ],
    });

    const worse = screen.getByText('+154 vs main');
    expect(worse.className).toMatch(/deltaWorse/);

    const better = screen.getByText('-84 vs main');
    expect(better.className).toMatch(/deltaBetter/);

    const same = screen.getByText('0 vs main');
    expect(same.className).toMatch(/deltaSame/);

    expect(screen.getByText('380').className).toMatch(/countSome/);
    expect(screen.getByText('0').className).toMatch(/countZero/);
  });

  it('orders the worst branch first when there is a reference', () => {
    renderPanel({
      official: fakeReport({ id: 'official', mode: 'baseline', branch: 'main', issueCount: 226 }),
      previews: [
        fakeReport({ id: 'better', branch: 'feat/mejora', issueCount: 142 }),
        fakeReport({ id: 'worse', branch: '32/merge', issueCount: 380 }),
      ],
    });

    const rows = screen.getAllByRole('button');
    expect(rows[0]!.getAttribute('aria-label')).toBe('Ver los 380 issues del reporte de PR #32');
    expect(rows[1]!.getAttribute('aria-label')).toBe('Ver los 142 issues del reporte de feat/mejora');
  });

  it('never invents a delta when there is no official report', () => {
    renderPanel({ previews: [fakeReport({ id: 'p1', branch: '32/merge', issueCount: 380 })] });

    const unknown = screen.getByText('— vs main');
    expect(unknown.className).toMatch(/deltaUnknown/);
    expect(screen.queryByText('0 vs main')).toBeNull();
    expect(screen.queryByText(/^\+\d+ vs main$/)).toBeNull();
  });

  it('renders no <a> inside the panel, with or without a github repository', () => {
    const previews = [fakeReport({ id: 'p1', branch: '32/merge', issueCount: 12 })];

    const withoutRepo = renderPanel({ previews });
    expect(withoutRepo.container.querySelectorAll('a')).toHaveLength(0);
    withoutRepo.unmount();

    const withRepo = renderPanel({ previews, githubRepository: 'centurionhq/prdmanager' });
    expect(withRepo.container.querySelectorAll('a')).toHaveLength(0);
  });

  it('uses the project default branch name, never a literal "main"', () => {
    renderPanel({
      official: fakeReport({ id: 'official', mode: 'baseline', branch: 'trunk', issueCount: 10 }),
      previews: [fakeReport({ id: 'p1', branch: 'feat/x', issueCount: 12 })],
      defaultBranch: 'trunk',
    });

    expect(screen.getByText('+2 vs trunk')).toBeTruthy();
  });
});
