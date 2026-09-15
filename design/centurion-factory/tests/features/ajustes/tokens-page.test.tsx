import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CiToken } from '../../../src/data';
import { TokensTable } from '../../../src/features/ajustes/TokensTable';
import { routes } from '../../../src/router';

function ciToken(overrides: Partial<CiToken>): CiToken {
  return {
    name: 'ci',
    prefix: 'prdm_ci_0000',
    scopes: [],
    branch: 'main',
    createdBy: 'ana-rios',
    createdAt: '2026-01-01',
    expiresAt: '2026-12-31',
    expired: false,
    ...overrides,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function tokensTable(): HTMLElement {
  return screen.getByRole('table', { name: 'Tokens de CI' });
}

function tokenRow(name: string): HTMLElement {
  const row = within(tokensTable()).getByText(name).closest('tr');
  if (!row) throw new Error(`Row for ${name} not found`);
  return row;
}

describe('TokensPage: demo states', () => {
  it('shows a skeleton while loading', () => {
    renderAt('/ajustes/tokens?estado=cargando');
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('shows an empty state with a next action', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/tokens?estado=vacio');
    expect(screen.getByText('No hay tokens de CI todavía.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Crear token' }));
    expect(screen.getByRole('dialog', { name: 'Crear token' })).toBeTruthy();
  });

  it('shows an error state with a retry action', () => {
    renderAt('/ajustes/tokens?estado=error');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });
});

describe('TokensPage: listo', () => {
  it('renders the section title, description and the 90-day note', async () => {
    renderAt('/ajustes/tokens');
    expect(screen.getByRole('heading', { level: 2, name: 'Tokens de CI' })).toBeTruthy();
    await screen.findByRole('table');
    expect(
      screen.getByText('Máximo 90 días. Rotalos antes de que venzan para no cortar el reporte oficial.'),
    ).toBeTruthy();
  });

  it('shows the mono branch only for main, not for "cualquier rama"', async () => {
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    const mainRow = tokenRow('github-actions-main');
    expect(within(mainRow).getByText('main').className).toContain('id');

    const previewsRow = tokenRow('github-actions-previews');
    expect(within(previewsRow).getByText('cualquier rama').className).not.toContain('id');
  });

  it('shows scope chips for each token', async () => {
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    const mainRow = tokenRow('github-actions-main');
    expect(within(mainRow).getByText('reports:write')).toBeTruthy();
    expect(within(mainRow).getByText('reports:baseline')).toBeTruthy();
  });

  it('labels every cell so the stacked mobile layout never runs values together (WO-316)', async () => {
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    const mainRow = tokenRow('github-actions-main');
    expect(within(mainRow).getByText('github-actions-main').closest('td')?.getAttribute('data-label')).toBe('Nombre');
    expect(within(mainRow).getByText('reports:write').closest('td')?.getAttribute('data-label')).toBe('Alcance');
    expect(within(mainRow).getByText('main').closest('td')?.getAttribute('data-label')).toBe('Rama');
  });

  it('shows the expired token muted with its expiry note and an Eliminar action', async () => {
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    const expiredRow = tokenRow('github-actions-nightly');
    expect(within(expiredRow).getByText('Venció el 01/09/2026')).toBeTruthy();
    expect(within(expiredRow).getByRole('button', { name: 'Eliminar' })).toBeTruthy();
    expect(within(expiredRow).queryByRole('button', { name: 'Revocar' })).toBeNull();
  });

  it('active tokens show a Revocar action that confirms before removing', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    const row = tokenRow('github-actions-previews');

    await user.click(within(row).getByRole('button', { name: 'Revocar' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Token revocado')).toBeTruthy();
    expect(screen.queryByText('github-actions-previews')).toBeNull();
  });

  it('deletes an expired token immediately with a toast', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    const row = tokenRow('github-actions-nightly');

    await user.click(within(row).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText('Token eliminado')).toBeTruthy();
    expect(screen.queryByText('github-actions-nightly')).toBeNull();
  });
});

describe('TokensTable: keyed by prefix (WO-318)', () => {
  it('revokes only the row whose prefix matches, even if two tokens share a name', async () => {
    const user = userEvent.setup();
    const onRevoke = vi.fn();
    const tokens = [
      ciToken({ name: 'ci', prefix: 'prdm_ci_aaaa' }),
      ciToken({ name: 'ci', prefix: 'prdm_ci_bbbb' }),
    ];
    render(<TokensTable tokens={tokens} onRevoke={onRevoke} onDelete={vi.fn()} />);

    const secondRow = screen.getByText('prdm_ci_bbbb…').closest('tr');
    if (!secondRow) throw new Error('row not found');
    await user.click(within(secondRow).getByRole('button', { name: 'Revocar' }));

    expect(onRevoke).toHaveBeenCalledWith(tokens[1]);
    expect(onRevoke).not.toHaveBeenCalledWith(tokens[0]);
  });
});

describe('TokensPage: create token', () => {
  beforeEach(() => {
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
    }
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a token, shows the one-time secret, copies it and then hides it for good', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Crear token' }));
    const dialog = screen.getByRole('dialog', { name: 'Crear token' });

    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'github-actions-staging');
    await user.click(within(dialog).getByRole('checkbox', { name: 'reports:write' }));
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Rama' }), 'main');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Vencimiento' }), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Crear token' }));

    expect(screen.queryByRole('dialog', { name: 'Crear token' })).toBeNull();
    expect(screen.getByText('Token creado')).toBeTruthy();
    expect(
      screen.getByText('Copiá el token ahora. Por seguridad no lo vamos a volver a mostrar.'),
    ).toBeTruthy();

    const secretField = screen.getByDisplayValue(/^prdm_ci_/);
    const secret = (secretField as HTMLInputElement).value;

    await user.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(secret);
    expect(await screen.findByText('Token copiado')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ya lo guardé' }));
    expect(screen.queryByText('Token creado')).toBeNull();
    expect(screen.getByText('github-actions-staging')).toBeTruthy();
  });

  it('rejects creating a token with an existing name (WO-318)', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/tokens');
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Crear token' }));
    const dialog = screen.getByRole('dialog', { name: 'Crear token' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'github-actions-main');
    await user.click(within(dialog).getByRole('button', { name: 'Crear token' }));

    expect(within(dialog).getByText('Ya existe un token con ese nombre.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Crear token' })).toBeTruthy();
    expect(screen.getAllByText('github-actions-main')).toHaveLength(1);
  });

  it('shows a fallback toast and selects the secret when the Clipboard API is unavailable (WO-318)', async () => {
    const user = userEvent.setup();
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Crear token' }));
    const dialog = screen.getByRole('dialog', { name: 'Crear token' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'sin-clipboard');
    await user.click(within(dialog).getByRole('button', { name: 'Crear token' }));

    const secretField = screen.getByDisplayValue(/^prdm_ci_/) as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(await screen.findByText('No pudimos copiar. Seleccioná el texto y copialo a mano.')).toBeTruthy();
    expect(secretField.selectionStart).toBe(0);
    expect(secretField.selectionEnd).toBe(secretField.value.length);

    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  it('shows the same fallback toast when writeText rejects (WO-318)', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    renderAt('/ajustes/tokens');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Crear token' }));
    const dialog = screen.getByRole('dialog', { name: 'Crear token' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'clipboard-denegado');
    await user.click(within(dialog).getByRole('button', { name: 'Crear token' }));

    await user.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(await screen.findByText('No pudimos copiar. Seleccioná el texto y copialo a mano.')).toBeTruthy();
  });
});
