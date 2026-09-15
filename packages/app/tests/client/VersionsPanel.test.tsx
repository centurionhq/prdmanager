import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentVersionSummary } from '@prdm/contracts';
import { VersionsPanel } from '../../src/components/VersionsPanel.js';
import * as collabContext from '../../src/collab/collab-document-context.js';
import * as versionsApi from '../../src/api/versions.js';
import type { ListDocumentVersionsPage } from '../../src/api/versions.js';

function fakeVersion(overrides: Partial<DocumentVersionSummary> = {}): DocumentVersionSummary {
  return {
    id: 'v1',
    versionNo: 1,
    label: 'First draft',
    reason: 'manual',
    renderedMarkdown: '---\nid: PRD-001\n---\n\nBody',
    frontmatter: {},
    contentHash: 'hash1',
    contributors: ['ana'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** WO-225: `listDocumentVersions` now resolves a paginated page, not a bare array. */
function fakeVersionsPage(versions: DocumentVersionSummary[]): ListDocumentVersionsPage {
  return { versions, total: versions.length, limit: 20, offset: 0 };
}

function mockContext() {
  const ydoc = new Y.Doc({ gc: false });
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: { document: ydoc, awareness: null, on: () => {}, off: () => {} } as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [] },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: () => {},
  });
}

describe('VersionsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists versions with label/reason/contributors', async () => {
    mockContext();
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue(fakeVersionsPage([fakeVersion()]));

    render(<VersionsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);

    expect(await screen.findByText(/v1 · First draft/)).toBeTruthy();
    expect(screen.getByText(/ana/)).toBeTruthy();
  });

  it('an editor can save a manual version with a label', async () => {
    mockContext();
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue(fakeVersionsPage([]));
    const save = vi.spyOn(versionsApi, 'saveDocumentVersion').mockResolvedValue(fakeVersion());

    render(<VersionsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Sin versiones todavía.');

    await userEvent.type(screen.getByLabelText('Etiqueta de la versión'), 'Milestone 1');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar versión' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('acme', 'web', 'PRD-001', 'Milestone 1'));
  });

  it('a viewer sees versions but no save form and no restore button', async () => {
    mockContext();
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue(fakeVersionsPage([fakeVersion()]));

    render(<VersionsPanel subject={{ orgRole: 'member', projectRole: 'viewer' }} />);
    await screen.findByText(/v1 · First draft/);

    expect(screen.queryByLabelText('Etiqueta de la versión')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull();
  });

  it('selecting two versions and comparing shows the diff', async () => {
    mockContext();
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue(fakeVersionsPage([fakeVersion({ id: 'v1', versionNo: 1 }), fakeVersion({ id: 'v2', versionNo: 2, label: 'Second' })]));
    vi.spyOn(versionsApi, 'getDocumentVersionDiff').mockResolvedValue({
      from: fakeVersion({ versionNo: 1 }),
      to: fakeVersion({ versionNo: 2 }),
      diff: [
        { type: 'equal', line: 'unchanged' },
        { type: 'removed', line: 'old line' },
        { type: 'added', line: 'new line' },
      ],
    });

    render(<VersionsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText(/v1 · First draft/);

    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[1]!);
    await userEvent.click(screen.getByRole('button', { name: /Comparar v1 → v2/ }));

    expect(await screen.findByText(/old line/)).toBeTruthy();
    expect(screen.getByText(/new line/)).toBeTruthy();
  });

  it('restoring a version requires confirmation before calling the API', async () => {
    mockContext();
    vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue(fakeVersionsPage([fakeVersion()]));
    const restore = vi.spyOn(versionsApi, 'restoreDocumentVersion').mockResolvedValue(fakeVersion({ versionNo: 2, reason: 'restore' }));

    render(<VersionsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText(/v1 · First draft/);

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    expect(restore).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar restauración' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith('acme', 'web', 'PRD-001', 1));
  });
});
