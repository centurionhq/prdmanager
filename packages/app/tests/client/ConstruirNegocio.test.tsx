/**
 * WO-562 (SDD-053/PRD-033 R2): the business path, through the real `ProjectShell` and the real
 * `ConstruirNegocio`. Only the API client is faked. What has to hold: the BC is born chained to the record it
 * came from (so it can actually be published later), the person never picks a kind or types a sigla, and when
 * there is nothing registered yet the screen says so before anything is written.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetail, DocumentSummary } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { errorMessage } from '../../src/api/error-message.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { ConstruirNegocio } from '../../src/routes/ConstruirNegocio.js';
import { ProjectShell } from '../../src/routes/ProjectShell.js';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

function summary(docId: string, kind: DocumentSummary['kind'], title: string, updatedAt = '2026-09-01T10:00:00.000Z'): DocumentSummary {
  return { id: `uuid-${docId}`, docId, kind, title, origin: 'generated', workflowState: 'published', sourcePath: `docs/${kind.toLowerCase()}/${docId}.md`, updatedAt };
}

const RECORDS: DocumentSummary[] = [
  summary('FB-026', 'FB', 'Nadie sabe por dónde empezar', '2026-09-10T10:00:00.000Z'),
  summary('ART-004', 'ART', 'Notas de la llamada con el equipo de soporte', '2026-09-12T10:00:00.000Z'),
  summary('FB-020', 'FB', 'El agente se siente colgado', '2026-09-02T10:00:00.000Z'),
];

function createdDetail(docId: string): DocumentDetail {
  return { docId, kind: 'BC', title: 'x', workflowState: 'draft' } as DocumentDetail;
}

interface Options {
  records?: () => Promise<DocumentSummary[]>;
  myRole?: 'viewer' | 'editor' | 'admin';
  orgRole?: 'owner' | 'member';
  create?: (input: { kind: string; title: string; fields?: { justified_by: string[] } }) => Promise<DocumentDetail>;
}

function renderPath({ records = () => Promise.resolve(RECORDS), myRole = 'editor', orgRole = 'member', create }: Options = {}) {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary({ role: orgRole })]);
  vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ myRole })]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });
  vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: 'negocio' });
  const listDocuments = vi.spyOn(client, 'listDocuments').mockImplementation(records);
  const createDocument = vi.spyOn(client, 'createDocument').mockImplementation((_org, _project, input) => (create ?? (() => Promise.resolve(createdDetail('BC-014'))))(input));

  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug',
        element: <ProjectShell />,
        children: [
          { index: true, element: <p>la planta</p> },
          { path: 'construir/negocio', element: <ConstruirNegocio /> },
          { path: 'entrada', element: <p>la bandeja de entrada</p> },
          { path: 'documents/:docId', element: <p>el documento</p> },
        ],
      },
    ],
    { initialEntries: ['/o/acme/p/web/construir/negocio'] },
  );
  render(<RouterProvider router={router} />);
  return { router, createDocument, listDocuments };
}

const TITLE_FIELD = /¿Qué querés proponer\?/;

afterEach(() => {
  vi.restoreAllMocks();
  clearQueryCache();
});

describe('ConstruirNegocio — with records to start from (WO-562, SDD-053)', () => {
  it('asks where the need comes from, offering the registered feedback and artifacts, newest first', async () => {
    renderPath();

    expect(await screen.findByRole('heading', { level: 1, name: '¿De dónde sale esta necesidad?' })).toBeTruthy();
    const group = await screen.findByRole('radiogroup', { name: 'Elegí de dónde sale' });
    const plates = within(group).getAllByRole('radio');
    expect(plates).toHaveLength(3);
    expect(plates[0]?.textContent).toContain('Notas de la llamada con el equipo de soporte');
    expect(plates[2]?.textContent).toContain('El agente se siente colgado');
  });

  it('never asks the person to pick a kind or to know a sigla', async () => {
    renderPath();

    await screen.findByRole('radiogroup', { name: 'Elegí de dónde sale' });
    expect(screen.queryByLabelText(/Tipo de documento/)).toBeNull();
    expect(screen.queryByText(/caso de negocio \(BC\)/i)).toBeNull();
    // Ids appear as the identifier of a record you recognise, never as something to choose between.
    expect(within(screen.getByRole('radiogroup', { name: 'Elegí de dónde sale' })).getByText('FB-026')).toBeTruthy();
  });

  it('only offers published records: a draft feedback is not something a BC can hang from', async () => {
    const { listDocuments } = renderPath();

    await screen.findByRole('radiogroup', { name: 'Elegí de dónde sale' });
    expect(listDocuments).toHaveBeenCalledWith('acme', 'web', { workflowState: 'published' });
  });

  it('leaves out everything that is not a record of what happened (no BC, PRD, SDD or work order)', async () => {
    const mixed = [...RECORDS, summary('BC-013', 'BC', 'Una iniciativa'), summary('PRD-033', 'PRD', 'Unos requisitos'), summary('SDD-051', 'SDD', 'Un diseño')];
    renderPath({ records: () => Promise.resolve(mixed) });

    const group = await screen.findByRole('radiogroup', { name: 'Elegí de dónde sale' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).queryByText('BC-013')).toBeNull();
    expect(within(group).queryByText('PRD-033')).toBeNull();
  });

  it('creates the business case chained to the chosen record and lands on the document', async () => {
    const { router, createDocument } = renderPath();

    await userEvent.click(await screen.findByRole('radio', { name: /Nadie sabe por dónde empezar/ }));
    expect(screen.getByText(/ya colgado de/).textContent).toContain('FB-026');
    await userEvent.type(screen.getByLabelText(TITLE_FIELD), '  Notificar cuando una orden se atrasa  ');
    await userEvent.click(screen.getByRole('button', { name: 'Empezar el caso de negocio' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/documents/BC-014'));
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith('acme', 'web', { kind: 'BC', title: 'Notificar cuando una orden se atrasa', fields: { justified_by: ['FB-026'] } });
  });

  it('starts on the newest record, so there is always one chosen and never an orphan business case', async () => {
    const { createDocument } = renderPath();

    await userEvent.type(await screen.findByLabelText(TITLE_FIELD), 'Algo');
    await userEvent.click(screen.getByRole('button', { name: 'Empezar el caso de negocio' }));

    await waitFor(() => expect(createDocument).toHaveBeenCalled());
    expect(createDocument.mock.calls[0]?.[2]).toMatchObject({ fields: { justified_by: ['ART-004'] } });
  });

  it('does not create anything without a title, and says what is missing', async () => {
    const { createDocument } = renderPath();

    await userEvent.click(await screen.findByRole('button', { name: 'Empezar el caso de negocio' }));

    expect((await screen.findByRole('alert')).textContent).toContain('título');
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('a second click while the first is still going does not create a second document', async () => {
    const { createDocument } = renderPath({ create: () => new Promise<DocumentDetail>(() => {}) });

    await userEvent.type(await screen.findByLabelText(TITLE_FIELD), 'Algo');
    const button = screen.getByRole('button', { name: 'Empezar el caso de negocio' });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('when creating fails it says so and keeps what was typed', async () => {
    const failure = new client.ApiClientError(404, 'not_found', 'FB-026 does not exist in this project');
    const { router } = renderPath({ create: () => Promise.reject(failure) });

    await userEvent.type(await screen.findByLabelText(TITLE_FIELD), 'Algo');
    await userEvent.click(screen.getByRole('button', { name: 'Empezar el caso de negocio' }));

    expect((await screen.findByRole('alert')).textContent).toContain(errorMessage(failure));
    expect((screen.getByLabelText(TITLE_FIELD) as HTMLInputElement).value).toBe('Algo');
    expect(router.state.location.pathname).toBe('/o/acme/p/web/construir/negocio');
  });

  it('says what happens after publishing, at the moment it matters and not when publishing fails', async () => {
    renderPath();

    const aside = await screen.findByText(/queda aprobada/);
    expect(aside.textContent).toContain('requisitos');
  });
});

describe('ConstruirNegocio — nothing registered yet (WO-560, SDD-053)', () => {
  it('says so before anything is written, and offers no way to create a business case out of nowhere', async () => {
    renderPath({ records: () => Promise.resolve([]) });

    expect(await screen.findByRole('heading', { name: 'Todavía no hay nada registrado de dónde partir' })).toBeTruthy();
    expect(screen.queryByLabelText(TITLE_FIELD)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empezar el caso de negocio' })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('also when the only published documents are not records of anything that happened', async () => {
    renderPath({ records: () => Promise.resolve([summary('BC-013', 'BC', 'Una iniciativa')]) });

    expect(await screen.findByRole('heading', { name: 'Todavía no hay nada registrado de dónde partir' })).toBeTruthy();
  });

  it('sends the person to register what they heard, in the inbox that already does that', async () => {
    const { router } = renderPath({ records: () => Promise.resolve([]) });

    await userEvent.click(await screen.findByRole('link', { name: 'Registrar lo que escuchaste' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/entrada'));
  });

  it('explains why, instead of just refusing', async () => {
    renderPath({ records: () => Promise.resolve([]) });

    expect((await screen.findByRole('heading', { name: 'Todavía no hay nada registrado de dónde partir' })).parentElement?.textContent).toMatch(/no podría publicarse/);
  });
});

describe('ConstruirNegocio — around the edges (WO-562, SDD-053)', () => {
  it('shows a loading state while the records are read, not the empty state', async () => {
    renderPath({ records: () => new Promise(() => {}) });

    await screen.findByRole('heading', { level: 1, name: '¿De dónde sale esta necesidad?' });
    expect(screen.queryByRole('heading', { name: 'Todavía no hay nada registrado de dónde partir' })).toBeNull();
  });

  it('says it could not read them, and can try again', async () => {
    const records = vi.fn().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValueOnce(RECORDS);
    renderPath({ records });

    expect(await screen.findByText('No pudimos cargar los registros')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));

    expect(await screen.findByRole('radiogroup', { name: 'Elegí de dónde sale' })).toBeTruthy();
  });

  it('a viewer, who cannot create documents, is told so instead of being handed a form that would fail', async () => {
    renderPath({ myRole: 'viewer' });

    expect(await screen.findByText(/No tenés permiso para crear documentos/)).toBeTruthy();
    expect(screen.queryByLabelText(TITLE_FIELD)).toBeNull();
  });

  it('the way back to the Planta is there', async () => {
    const { router } = renderPath();

    const header = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement;
    await userEvent.click(within(header).getByRole('link', { name: 'Planta' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web'));
  });
});
