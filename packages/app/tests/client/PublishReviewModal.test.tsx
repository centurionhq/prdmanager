import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentVersionListItem, DocumentVersionSummary } from '@prdm/contracts';
import * as versionsApi from '../../src/api/versions.js';
import { PublishReviewModal } from '../../src/components/PublishReviewModal/PublishReviewModal.js';

const CURRENT_VERSION: DocumentVersionSummary = {
  id: 'v2',
  versionNo: 2,
  label: null,
  reason: 'review_request',
  renderedMarkdown: '---\nid: SDD-011\nstatus: "approved"\nimpacts_paths: ["a/**", "b/**"]\n---\n## Tareas\n\n- [ ] tarea vieja\n- [ ] tarea nueva',
  frontmatter: { status: 'approved', architects: ['PRD-007'] },
  contentHash: 'hash2',
  contributors: ['u1'],
  createdAt: '2026-01-02T00:00:00.000Z',
};

const PREVIOUS_VERSION: DocumentVersionListItem = {
  id: 'v1',
  versionNo: 1,
  label: null,
  reason: 'published',
  frontmatter: { status: 'in_review' },
  contentHash: 'hash1',
  contributors: ['u1'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function baseProps(overrides: Partial<React.ComponentProps<typeof PublishReviewModal>> = {}) {
  return {
    open: true,
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'SDD-011',
    kind: 'SDD' as const,
    currentVersion: CURRENT_VERSION,
    publishedVersionId: 'v1',
    validation: null,
    busy: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
}

describe('PublishReviewModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the previously published version and shows the frontmatter/tasks diff plus impacts_paths warning', async () => {
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue({ versions: [PREVIOUS_VERSION], total: 1, limit: 200, offset: 0 });
    vi.spyOn(versionsApi, 'getDocumentVersionDiff').mockResolvedValue({
      from: { ...PREVIOUS_VERSION, renderedMarkdown: '' },
      to: CURRENT_VERSION,
      diff: [
        { type: 'equal', line: '---' },
        { type: 'removed', line: 'status: "in_review"' },
        { type: 'added', line: 'status: "approved"' },
        { type: 'added', line: 'impacts_paths: ["a/**", "b/**"]' },
        { type: 'equal', line: '---' },
        { type: 'equal', line: '## Tareas' },
        { type: 'equal', line: '- [ ] tarea vieja' },
        { type: 'added', line: '- [ ] tarea nueva' },
      ],
    });

    render(<PublishReviewModal {...baseProps()} />);

    expect(await screen.findByText('status: "approved"')).toBeTruthy();
    expect(screen.getByText('- [ ] tarea nueva')).toBeTruthy();
    expect(screen.getByText(/impacts_paths cambió/)).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.tagName === 'P' && (element.textContent ?? '').includes('1 tarea nueva va a generar 1 orden de trabajo al publicar.')),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publicar versión 2' })).toBeTruthy();

    // architects was added relative to the previous version's frontmatter.
    expect(screen.getByText('architects')).toBeTruthy();
  });

  it('confirming calls onConfirm, never onClose, and closing never calls onConfirm', async () => {
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue({ versions: [PREVIOUS_VERSION], total: 1, limit: 200, offset: 0 });
    vi.spyOn(versionsApi, 'getDocumentVersionDiff').mockResolvedValue({ from: PREVIOUS_VERSION as never, to: CURRENT_VERSION, diff: [] });
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(<PublishReviewModal {...baseProps({ onConfirm, onClose })} />);
    await screen.findByRole('button', { name: 'Publicar versión 2' });

    await userEvent.click(screen.getByRole('button', { name: 'Publicar versión 2' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Volver a editar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows a first-publish fallback (checklist items, no diff fetch) when there is no published version yet', async () => {
    const listDocumentVersions = vi.spyOn(versionsApi, 'listDocumentVersions');

    render(<PublishReviewModal {...baseProps({ publishedVersionId: null })} />);

    expect(await screen.findByText('- [ ] tarea vieja')).toBeTruthy();
    expect(screen.getByText('- [ ] tarea nueva')).toBeTruthy();
    expect(listDocumentVersions).not.toHaveBeenCalled();
  });

  it('shows the real validation summary passed in', async () => {
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue({ versions: [PREVIOUS_VERSION], total: 1, limit: 200, offset: 0 });
    vi.spyOn(versionsApi, 'getDocumentVersionDiff').mockResolvedValue({ from: PREVIOUS_VERSION as never, to: CURRENT_VERSION, diff: [] });

    render(<PublishReviewModal {...baseProps({ validation: [{ severity: 'error', code: 'x', message: 'algo falta' }] })} />);

    expect(await screen.findByText('1 error, 0 avisos')).toBeTruthy();
  });

  it('shows a load error inline without blocking the confirm button', async () => {
    vi.spyOn(versionsApi, 'listDocumentVersions').mockRejectedValue(new Error('boom'));

    render(<PublishReviewModal {...baseProps()} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publicar versión 2' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
