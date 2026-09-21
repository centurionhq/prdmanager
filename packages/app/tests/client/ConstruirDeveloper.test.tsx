/**
 * WO-572 (SDD-055/PRD-033 R4): the developer path, through the real `ProjectShell` and the real
 * `ConstruirDeveloper`. Only the API client is faked. What has to hold: the commands carry this project and
 * this server, the state shown is the one the server can actually know, and nothing claims to see the files
 * that live on the person's own machine.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenSummaryDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { ConstruirDeveloper } from '../../src/routes/ConstruirDeveloper.js';
import { ProjectShell } from '../../src/routes/ProjectShell.js';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

function token(overrides: Partial<TokenSummaryDto> = {}): TokenSummaryDto {
  return {
    id: 't1',
    kind: 'personal',
    name: 'mi portátil',
    prefix: 'prdm_ab',
    scopes: ['mcp:read', 'mcp:write'],
    expiresAt: '2099-01-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface Options {
  tokens?: () => Promise<TokenSummaryDto[]>;
  awaitingFirstReport?: boolean;
}

function renderPath({ tokens = () => Promise.resolve([]), awaitingFirstReport = false }: Options = {}) {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
  vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ myRole: 'editor', graphProjectId: 'prj_abc123', awaitingFirstReport })]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });
  vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: 'developer' });
  const listPersonalTokens = vi.spyOn(client, 'listPersonalTokens').mockImplementation(tokens);

  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug',
        element: <ProjectShell />,
        children: [
          { index: true, element: <p>la planta</p> },
          { path: 'construir/developer', element: <ConstruirDeveloper /> },
          { path: 'ajustes/tokens-personales', element: <p>mis credenciales</p> },
          { path: 'ordenes', element: <p>las órdenes</p> },
        ],
      },
    ],
    { initialEntries: ['/o/acme/p/web/construir/developer'] },
  );
  render(<RouterProvider router={router} />);
  return { router, listPersonalTokens };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearQueryCache();
});

describe('ConstruirDeveloper — nothing set up yet (WO-572, SDD-055)', () => {
  it('says it is not connected and points at the first step, creating the credential', async () => {
    renderPath();

    expect(await screen.findByRole('heading', { level: 1, name: 'Conectar tu entorno a este proyecto' })).toBeTruthy();
    expect(screen.getByText('Sin conectar')).toBeTruthy();
    const pasos = within(screen.getByRole('list', { name: 'Pasos de puesta en marcha' })).getAllByRole('listitem');
    expect(pasos).toHaveLength(3);
    expect(pasos[0]?.textContent).toContain('Crear tu credencial');
    expect(pasos[0]?.getAttribute('aria-current')).toBe('step');
    expect(pasos[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('sends the person to where credentials are actually created, instead of creating one here', async () => {
    const { router } = renderPath();

    await userEvent.click(await screen.findByRole('link', { name: 'Crear credencial' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/ajustes/tokens-personales'));
  });

  it('shows the commands for this project and this server, ready to copy', async () => {
    renderPath();

    const comandos = await screen.findByRole('group', { name: 'Comandos para vincular el repositorio' });
    expect(comandos.textContent).toContain(`prdm login --server ${window.location.origin}`);
    expect(comandos.textContent).toContain(`prdm link acme/web --server ${window.location.origin} --mcp`);
    expect(comandos.textContent).toContain('prdm hooks install');
  });

  it('copies exactly those commands', async () => {
    renderPath();
    const comandos = await screen.findByRole('group', { name: 'Comandos para vincular el repositorio' });

    await userEvent.click(within(comandos).getByRole('button', { name: 'Copiar' }));

    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(copied).toContain('prdm link acme/web');
    expect(copied).toContain('prdm hooks install');
  });
});

describe('ConstruirDeveloper — credential created but never used (WO-572, SDD-055)', () => {
  it('marks the credential done and points at linking the repository', async () => {
    renderPath({ tokens: () => Promise.resolve([token()]) });

    expect(await screen.findByText('Credencial creada, falta vincular')).toBeTruthy();
    const pasos = within(screen.getByRole('list', { name: 'Pasos de puesta en marcha' })).getAllByRole('listitem');
    expect(within(pasos[0] as HTMLElement).getByText('Listo')).toBeTruthy();
    expect(pasos[1]?.getAttribute('aria-current')).toBe('step');
  });

  it('never claims the repository is not linked: it says what it saw, which is no connection yet', async () => {
    renderPath({ tokens: () => Promise.resolve([token()]) });

    expect(await screen.findByText(/Todavía no vimos ninguna conexión/)).toBeTruthy();
  });

  it('an expired or revoked credential does not count as created', async () => {
    renderPath({ tokens: () => Promise.resolve([token({ revokedAt: '2026-01-02T00:00:00.000Z' }), token({ id: 't2', expiresAt: '2020-01-01T00:00:00.000Z' })]) });

    expect(await screen.findByText('Sin conectar')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Crear credencial' })).toBeTruthy();
  });
});

describe('ConstruirDeveloper — connected (WO-572, SDD-055)', () => {
  it('says it is connected, with nothing left to do', async () => {
    renderPath({ tokens: () => Promise.resolve([token({ lastUsedAt: '2026-09-19T10:00:00.000Z' })]) });

    expect(await screen.findByText('Conectado')).toBeTruthy();
    expect(screen.queryByRole('listitem', { current: 'step' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver mis credenciales' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Crear credencial' })).toBeNull();
  });
});

describe('ConstruirDeveloper — the assistant (WO-572, SDD-055)', () => {
  it('offers only the assistants this repository documents, and Claude Code needs nothing pasted', async () => {
    renderPath();

    const grupo = await screen.findByRole('radiogroup', { name: 'Elegí tu asistente' });
    const chips = within(grupo).getAllByRole('radio');
    expect(chips.map((c) => c.textContent)).toEqual(['Claude Code', 'Otro cliente MCP']);
    expect(screen.getByText(/ya escribió el archivo .mcp.json/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Entrada para tu cliente MCP' })).toBeNull();
  });

  it('for any other client it shows the entry to paste, with no secret in it', async () => {
    renderPath();

    await userEvent.click(within(await screen.findByRole('radiogroup', { name: 'Elegí tu asistente' })).getByRole('radio', { name: 'Otro cliente MCP' }));

    const entrada = screen.getByRole('group', { name: 'Entrada para tu cliente MCP' });
    expect(entrada.textContent).toContain('"prdm-remote"');
    expect(entrada.textContent).toContain('mcp-proxy');
    expect(entrada.textContent).not.toMatch(/prdm_[a-z0-9]/i);
  });
});

describe('ConstruirDeveloper — this project (WO-571, SDD-055)', () => {
  it('shows the identifier, the server and the official branch', async () => {
    renderPath();

    const datos = await screen.findByRole('complementary', { name: 'Datos de este proyecto' });
    expect(datos.textContent).toContain('prj_abc123');
    expect(datos.textContent).toContain(window.location.origin);
    expect(datos.textContent).toContain('main');
  });

  it('warns that the tree stays empty until the first CI report', async () => {
    renderPath({ awaitingFirstReport: true });

    expect(await screen.findByText(/hasta el primer reporte/)).toBeTruthy();
  });

  it('does not warn once that report arrived', async () => {
    renderPath({ awaitingFirstReport: false });

    await screen.findByRole('complementary', { name: 'Datos de este proyecto' });
    expect(screen.queryByText(/hasta el primer reporte/)).toBeNull();
  });

  it('points at the work orders waiting on the other side of the setup', async () => {
    const { router } = renderPath();

    await userEvent.click(await screen.findByRole('link', { name: 'Ver órdenes pendientes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/ordenes'));
  });
});

describe('ConstruirDeveloper — around the edges (WO-572, SDD-055)', () => {
  it('reads the credentials of this organization', async () => {
    const { listPersonalTokens } = renderPath();

    await screen.findByRole('heading', { level: 1, name: 'Conectar tu entorno a este proyecto' });
    await waitFor(() => expect(listPersonalTokens).toHaveBeenCalledWith('acme'));
  });

  it('when the credentials cannot be read, the steps and the commands are still there', async () => {
    renderPath({ tokens: () => Promise.reject(new Error('sin conexión')) });

    expect(await screen.findByRole('group', { name: 'Comandos para vincular el repositorio' })).toBeTruthy();
    // The screen draws first and the failed read lands a tick later: wait for the notice, do not race it.
    expect(await screen.findByText(/No pudimos leer tus credenciales/)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Pasos de puesta en marcha' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('the way back to the Planta is there', async () => {
    const { router } = renderPath();

    const header = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement;
    await userEvent.click(within(header).getByRole('link', { name: 'Planta' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web'));
  });
});
