import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ValidationIssueSummary } from '@prdm/contracts';
import { ValidationPanel } from '../../src/components/ValidationPanel.js';
import * as collabContext from '../../src/collab/collab-document-context.js';

function mockContext() {
  const ydoc = new Y.Doc({ gc: false });
  const handlers = new Map<string, (data: { payload: string }) => void>();
  const provider = {
    document: ydoc,
    awareness: null,
    on: (_event: string, handler: (data: { payload: string }) => void) => handlers.set(_event, handler),
    off: (_event: string) => handlers.delete(_event),
  };
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: provider as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [] },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: () => {},
  });
  return {
    emitValidationUpdated: (issues: ValidationIssueSummary[]) => {
      act(() => handlers.get('stateless')?.({ payload: JSON.stringify({ type: 'validation:updated', issues }) }));
    },
  };
}

const noop = () => {};

describe('ValidationPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows "sin problemas" when there are no issues', () => {
    mockContext();
    render(
      <ValidationPanel subject={{ orgRole: 'member', projectRole: 'editor' }} initialIssues={[]} canRequestReview={false} canPublish={false} canArchive={false} busy={false} onRequestReview={noop} onPublish={noop} onArchive={noop} />,
    );
    expect(screen.getByText('Sin problemas de validación.')).toBeTruthy();
  });

  it('groups issues by severity', () => {
    mockContext();
    const issues: ValidationIssueSummary[] = [
      { severity: 'error', code: 'broken_link', field: 'implements', message: 'missing SDD-001' },
      { severity: 'warning', code: 'lifecycle', message: 'consider updating' },
    ];
    render(
      <ValidationPanel subject={{ orgRole: 'member', projectRole: 'editor' }} initialIssues={issues} canRequestReview={false} canPublish={false} canArchive={false} busy={false} onRequestReview={noop} onPublish={noop} onArchive={noop} />,
    );
    expect(screen.getByText(/Errores \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Advertencias \(1\)/)).toBeTruthy();
    expect(screen.getByText(/missing SDD-001/)).toBeTruthy();
  });

  it('disables Publicar with a visible reason when there is a blocking error', () => {
    mockContext();
    const issues: ValidationIssueSummary[] = [{ severity: 'error', code: 'broken_link', message: 'bad link' }];
    render(
      <ValidationPanel subject={{ orgRole: 'member', projectRole: 'admin' }} initialIssues={issues} canRequestReview={false} canPublish={true} canArchive={false} busy={false} onRequestReview={noop} onPublish={noop} onArchive={noop} />,
    );
    const publish = screen.getByRole('button', { name: 'Publicar' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.getByText('hay errores de validación bloqueantes')).toBeTruthy();
  });

  it('Publicar is enabled when there are only warnings, not errors', () => {
    mockContext();
    const issues: ValidationIssueSummary[] = [{ severity: 'warning', code: 'lifecycle', message: 'fyi' }];
    render(
      <ValidationPanel subject={{ orgRole: 'member', projectRole: 'admin' }} initialIssues={issues} canRequestReview={false} canPublish={true} canArchive={false} busy={false} onRequestReview={noop} onPublish={noop} onArchive={noop} />,
    );
    expect((screen.getByRole('button', { name: 'Publicar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking Solicitar revisión calls the handler', async () => {
    mockContext();
    const onRequestReview = vi.fn();
    render(
      <ValidationPanel subject={{ orgRole: 'member', projectRole: 'editor' }} initialIssues={[]} canRequestReview={true} canPublish={false} canArchive={false} busy={false} onRequestReview={onRequestReview} onPublish={noop} onArchive={noop} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar revisión' }));
    expect(onRequestReview).toHaveBeenCalledTimes(1);
  });

  it('updates live from a validation:updated stateless broadcast', () => {
    const { emitValidationUpdated } = mockContext();
    render(
      <ValidationPanel subject={{ orgRole: 'member', projectRole: 'editor' }} initialIssues={[]} canRequestReview={false} canPublish={false} canArchive={false} busy={false} onRequestReview={noop} onPublish={noop} onArchive={noop} />,
    );
    expect(screen.getByText('Sin problemas de validación.')).toBeTruthy();

    emitValidationUpdated([{ severity: 'error', code: 'broken_link', message: 'now broken' }]);

    expect(screen.getByText(/now broken/)).toBeTruthy();
    expect(screen.queryByText('Sin problemas de validación.')).toBeNull();
  });
});
