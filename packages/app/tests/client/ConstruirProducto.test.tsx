/**
 * WO-554 (SDD-052/PRD-033 R3): the product path, exercised through the real `ProjectShell` and the real
 * `ConstruirProducto`. Only the API client is faked. What has to hold: a PRD is never created without an
 * initiative, it leaves already chained to the one that was picked, and when there is no approved initiative
 * the screen says so before anyone writes anything.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetail, DocumentSummary, FeatureLineDto, LineBoardDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { errorMessage } from '../../src/api/error-message.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { ConstruirProducto } from '../../src/routes/ConstruirProducto.js';
import { ProjectShell } from '../../src/routes/ProjectShell.js';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

function lane(overrides: Partial<FeatureLineDto> & Pick<FeatureLineDto, 'id' | 'title'>): FeatureLineDto {
  return { kind: 'BC', status: 'approved', station: 'caso_negocio', progress: { done: 0, total: 0, stopped: 0 }, children: [], ...overrides };
}

const CHILD_PRD: FeatureLineDto = lane({ id: 'PRD-030', kind: 'PRD', title: 'Un PRD ya colgado', station: 'producto' });

const APPROVED_LINE_BOARD: LineBoardDto = {
  features: [
    lane({ id: 'BC-013', title: 'Mejorar experiencia de negocio, producto y developers', children: [CHILD_PRD, { ...CHILD_PRD, id: 'PRD-031' }] }),
    lane({ id: 'BC-010', title: 'Un agente que trabaja bien pero no se ve trabajar', children: [CHILD_PRD] }),
    lane({ id: 'BC-009', title: 'Un agente que sólo puede leer no ahorra escribir' }),
    // Not initiatives you can hang requirements from: a BC that is not approved, and a lane that is not a BC.
    lane({ id: 'BC-008', title: 'Una iniciativa en borrador', status: 'draft' }),
    lane({ id: 'PRD-020', kind: 'PRD', title: 'Un PRD suelto', station: 'producto' }),
  ],
  andon: null,
};

const NO_APPROVED_LINE_BOARD: LineBoardDto = { features: [lane({ id: 'BC-008', title: 'Una iniciativa en borrador', status: 'draft' })], andon: null };

function summary(docId: string, workflowState: DocumentSummary['workflowState']): DocumentSummary {
  return { docId, kind: 'BC', title: `Caso ${docId}`, workflowState, sourcePath: `docs/bc/${docId}.md` } as DocumentSummary;
}

function createdDetail(docId: string): DocumentDetail {
  return { docId, kind: 'PRD', title: 'x', workflowState: 'draft' } as DocumentDetail;
}

interface Options {
  lineBoard?: () => Promise<LineBoardDto>;
  drafts?: () => Promise<DocumentSummary[]>;
  myRole?: 'viewer' | 'editor' | 'admin';
  orgRole?: 'owner' | 'member';
  create?: (input: { kind: string; title: string; fields?: { justified_by: string[] } }) => Promise<DocumentDetail>;
}

function renderPath({ lineBoard = () => Promise.resolve(APPROVED_LINE_BOARD), drafts = () => Promise.resolve([]), myRole = 'editor', orgRole = 'member', create }: Options = {}) {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary({ role: orgRole })]);
  vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ myRole })]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });
  vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: 'producto' });
  vi.spyOn(client, 'getLineBoard').mockImplementation(lineBoard);
  const listDocuments = vi.spyOn(client, 'listDocuments').mockImplementation(drafts);
  const createDocument = vi.spyOn(client, 'createDocument').mockImplementation((_org, _project, input) => (create ?? (() => Promise.resolve(createdDetail('PRD-040'))))(input));

  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug',
        element: <ProjectShell />,
        children: [
          { index: true, element: <p>la planta</p> },
          { path: 'construir/producto', element: <ConstruirProducto /> },
          { path: 'construir/negocio', element: <p>destino: negocio</p> },
          { path: 'documents', element: <p>la lista de documentos</p> },
          { path: 'documents/:docId', element: <p>el documento</p> },
        ],
      },
    ],
    { initialEntries: ['/o/acme/p/web/construir/producto'] },
  );
  render(<RouterProvider router={router} />);
  return { router, createDocument, listDocuments };
}

const TITLE_FIELD = /¿Qué querés definir\?/;

afterEach(() => {
  vi.restoreAllMocks();
  clearQueryCache();
});

describe('ConstruirProducto — with approved initiatives (WO-554, SDD-052)', () => {
  it('asks which initiative the requirements come from, and offers only the approved ones', async () => {
    renderPath();

    expect(await screen.findByRole('heading', { level: 1, name: '¿De qué iniciativa salen estos requisitos?' })).toBeTruthy();
    const group = await screen.findByRole('radiogroup', { name: 'Elegí la iniciativa' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).getByRole('radio', { name: /Mejorar experiencia de negocio/ })).toBeTruthy();
    expect(within(group).queryByRole('radio', { name: /en borrador/ })).toBeNull();
    expect(within(group).queryByRole('radio', { name: /PRD suelto/ })).toBeNull();
  });

  it('says what each initiative already has hanging from it, in plain words and singular or plural', async () => {
    renderPath();

    const group = await screen.findByRole('radiogroup', { name: 'Elegí la iniciativa' });
    expect(within(within(group).getByRole('radio', { name: /Mejorar experiencia de negocio/ })).getByText(/2 documentos de requisitos ya colgados/)).toBeTruthy();
    expect(within(within(group).getByRole('radio', { name: /no se ve trabajar/ })).getByText(/1 documento de requisitos ya colgado$/)).toBeTruthy();
    expect(within(within(group).getByRole('radio', { name: /sólo puede leer/ })).getByText(/Todavía sin documentos de requisitos/)).toBeTruthy();
    expect(within(group).getByText('BC-013')).toBeTruthy();
  });

  it('starts on the first initiative and says, next to the button, which one the document will hang from', async () => {
    renderPath();

    const group = await screen.findByRole('radiogroup', { name: 'Elegí la iniciativa' });
    expect(within(group).getByRole('radio', { name: /Mejorar experiencia de negocio/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/ya colgado de/).textContent).toContain('BC-013');
  });

  it('creates the PRD already chained to the initiative that was picked, with no frontmatter to edit, and lands on the document', async () => {
    const { router, createDocument } = renderPath();

    await userEvent.click(await screen.findByRole('radio', { name: /no se ve trabajar/ }));
    expect(screen.getByText(/ya colgado de/).textContent).toContain('BC-010');
    await userEvent.type(screen.getByLabelText(TITLE_FIELD), 'Aviso de orden atrasada en el panel del equipo');
    await userEvent.click(screen.getByRole('button', { name: 'Escribir los requisitos' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/documents/PRD-040'));
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith('acme', 'web', {
      kind: 'PRD',
      title: 'Aviso de orden atrasada en el panel del equipo',
      fields: { justified_by: ['BC-010'] },
    });
  });

  it('trims the title before sending it', async () => {
    const { createDocument } = renderPath();

    await userEvent.type(await screen.findByLabelText(TITLE_FIELD), '   Aviso   ');
    await userEvent.click(screen.getByRole('button', { name: 'Escribir los requisitos' }));

    await waitFor(() => expect(createDocument).toHaveBeenCalled());
    expect(createDocument.mock.calls[0]?.[2]).toMatchObject({ title: 'Aviso' });
  });

  it('does not create anything without a title, and says what is missing', async () => {
    const { createDocument } = renderPath();

    await userEvent.click(await screen.findByRole('button', { name: 'Escribir los requisitos' }));

    expect((await screen.findByRole('alert')).textContent).toContain('título');
    expect(createDocument).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(TITLE_FIELD), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Escribir los requisitos' }));
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('a second click while the first is still going does not create a second document', async () => {
    let finish: (doc: DocumentDetail) => void = () => {};
    const { createDocument } = renderPath({ create: () => new Promise<DocumentDetail>((resolve) => (finish = resolve)) });

    await userEvent.type(await screen.findByLabelText(TITLE_FIELD), 'Aviso');
    const button = screen.getByRole('button', { name: 'Escribir los requisitos' });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    finish(createdDetail('PRD-041'));
  });

  it('when creating fails it says so, keeps what was typed and the chosen initiative, and lets the person try again', async () => {
    const create = vi.fn().mockRejectedValueOnce(new client.ApiClientError(404, 'not_found', 'BC-010 does not exist in this project')).mockResolvedValueOnce(createdDetail('PRD-042'));
    const { router } = renderPath({ create });

    await userEvent.click(await screen.findByRole('radio', { name: /no se ve trabajar/ }));
    await userEvent.type(screen.getByLabelText(TITLE_FIELD), 'Aviso');
    await userEvent.click(screen.getByRole('button', { name: 'Escribir los requisitos' }));

    expect((await screen.findByRole('alert')).textContent).toContain(errorMessage(new client.ApiClientError(404, 'not_found', 'BC-010 does not exist in this project')));
    expect((screen.getByLabelText(TITLE_FIELD) as HTMLInputElement).value).toBe('Aviso');
    expect(screen.getByRole('radio', { name: /no se ve trabajar/ }).getAttribute('aria-checked')).toBe('true');
    expect(router.state.location.pathname).toBe('/o/acme/p/web/construir/producto');

    await userEvent.click(screen.getByRole('button', { name: 'Escribir los requisitos' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/documents/PRD-042'));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('never asks the server for the drafts while there are approved initiatives to choose from', async () => {
    const { listDocuments } = renderPath();

    await screen.findByRole('radiogroup', { name: 'Elegí la iniciativa' });
    expect(listDocuments).not.toHaveBeenCalled();
  });
});

describe('ConstruirProducto — no approved initiative (WO-553, SDD-052)', () => {
  it('says so before anything is written, and offers no way to create a PRD without an initiative', async () => {
    renderPath({ lineBoard: () => Promise.resolve(NO_APPROVED_LINE_BOARD) });

    expect(await screen.findByRole('heading', { name: 'Todavía no hay ninguna iniciativa aprobada' })).toBeTruthy();
    expect(screen.getByText(/preferimos decírtelo ahora/)).toBeTruthy();
    expect(screen.queryByLabelText(TITLE_FIELD)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Escribir los requisitos' })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('also when the project has nothing on the line at all', async () => {
    renderPath({ lineBoard: () => Promise.resolve({ features: [], andon: null }) });

    expect(await screen.findByRole('heading', { name: 'Todavía no hay ninguna iniciativa aprobada' })).toBeTruthy();
  });

  it('offers to go and write the business case', async () => {
    const { router } = renderPath({ lineBoard: () => Promise.resolve(NO_APPROVED_LINE_BOARD) });

    await userEvent.click(await screen.findByRole('link', { name: 'Escribir el caso de negocio' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/construir/negocio'));
  });

  it('counts the business cases that are written but not published, and leaves out archived and published ones', async () => {
    const drafts = [summary('BC-005', 'draft'), summary('BC-006', 'in_review'), summary('BC-007', 'published'), summary('BC-004', 'archived')];
    const { listDocuments } = renderPath({ lineBoard: () => Promise.resolve(NO_APPROVED_LINE_BOARD), drafts: () => Promise.resolve(drafts) });

    expect(await screen.findByText(/iniciativas escritas pero sin publicar/)).toBeTruthy();
    expect(screen.getByText(/iniciativas escritas pero sin publicar/).parentElement?.textContent).toMatch(/Hay 2 iniciativas escritas/);
    expect(listDocuments).toHaveBeenCalledWith('acme', 'web', { kind: 'BC' });
  });

  it('says it in the singular for one, and says nothing about drafts when there are none', async () => {
    renderPath({ lineBoard: () => Promise.resolve(NO_APPROVED_LINE_BOARD), drafts: () => Promise.resolve([summary('BC-005', 'draft')]) });
    expect((await screen.findByText(/Hay 1 iniciativa escrita pero sin publicar/)).textContent).toContain('publicarla la deja aprobada');
  });

  it('does not mention drafts at all when there are none', async () => {
    renderPath({ lineBoard: () => Promise.resolve(NO_APPROVED_LINE_BOARD), drafts: () => Promise.resolve([summary('BC-007', 'published')]) });

    await screen.findByRole('heading', { name: 'Todavía no hay ninguna iniciativa aprobada' });
    await waitFor(() => expect(client.listDocuments).toHaveBeenCalled());
    expect(screen.queryByText(/sin publicar/)).toBeNull();
  });

  it('still shows the empty state, minus the count, when the drafts cannot be read', async () => {
    renderPath({ lineBoard: () => Promise.resolve(NO_APPROVED_LINE_BOARD), drafts: () => Promise.reject(new Error('boom')) });

    expect(await screen.findByRole('heading', { name: 'Todavía no hay ninguna iniciativa aprobada' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Escribir el caso de negocio' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ConstruirProducto — around the edges (WO-554, SDD-052)', () => {
  it('shows a loading state while the line is read, not the empty state', async () => {
    renderPath({ lineBoard: () => new Promise(() => {}) });

    await screen.findByRole('heading', { level: 1, name: '¿De qué iniciativa salen estos requisitos?' });
    expect(screen.queryByRole('heading', { name: 'Todavía no hay ninguna iniciativa aprobada' })).toBeNull();
  });

  it('says it could not read the line, and can try again', async () => {
    const lineBoard = vi.fn().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValueOnce(APPROVED_LINE_BOARD);
    renderPath({ lineBoard });

    expect(await screen.findByText('No pudimos cargar las iniciativas')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Todavía no hay ninguna iniciativa aprobada' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));

    expect(await screen.findByRole('radiogroup', { name: 'Elegí la iniciativa' })).toBeTruthy();
  });

  it('a viewer, who cannot create documents, is told so instead of being handed a form that would fail', async () => {
    renderPath({ myRole: 'viewer' });

    expect(await screen.findByText(/No tenés permiso para crear documentos/)).toBeTruthy();
    expect(screen.queryByLabelText(TITLE_FIELD)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Escribir los requisitos' })).toBeNull();
  });

  it('the way back to the Planta is there', async () => {
    const { router } = renderPath();

    const header = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement;
    await userEvent.click(within(header).getByRole('link', { name: 'Planta' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web'));
  });
});
