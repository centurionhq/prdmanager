/**
 * WO-580 (SDD-056/PRD-036 R2/R4): the token table and the one-time secret card, on the design system.
 * Behaviour that must not move: a revoked token offers no action, and the secret is shown once, copyable.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenSummaryDto } from '@prdm/contracts';
import { TokenSecretPanel } from '../../src/components/TokenSecretPanel.js';
import { TokenTable } from '../../src/components/TokenTable.js';

function token(overrides: Partial<TokenSummaryDto> = {}): TokenSummaryDto {
  return {
    id: 't1',
    kind: 'project_ci',
    name: 'github-actions-main',
    prefix: 'prdm_ci_7f3a',
    scopes: ['reports:write', 'reports:baseline'],
    expiresAt: '2099-12-14T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    createdByName: 'Ana Ríos',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TokenTable (WO-580, SDD-056)', () => {
  it('says there are no tokens instead of drawing an empty table', () => {
    render(<TokenTable tokens={[]} onRevoke={() => {}} />);

    expect(screen.getByText(/Todavía no hay tokens/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('draws a real table with the columns the canvas names', () => {
    render(<TokenTable tokens={[token()]} onRevoke={() => {}} />);

    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Nombre', 'Prefijo', 'Alcance', 'Vence', 'Último uso', 'Estado']));
  });

  it('shows who made it and when, the prefix as an identifier, and each scope on its own', () => {
    render(<TokenTable tokens={[token()]} onRevoke={() => {}} />);

    const row = screen.getByRole('row', { name: /github-actions-main/ });
    expect(within(row).getByText('github-actions-main')).toBeTruthy();
    expect(within(row).getByText(/Ana Ríos/)).toBeTruthy();
    expect(within(row).getByText('prdm_ci_7f3a')).toBeTruthy();
    expect(within(row).getByText('reports:write')).toBeTruthy();
    expect(within(row).getByText('reports:baseline')).toBeTruthy();
  });

  it('writes dates as a person reads them, not as an ISO string', () => {
    render(<TokenTable tokens={[token({ expiresAt: '2099-12-14T12:00:00.000Z', lastUsedAt: '2026-09-19T10:00:00.000Z' })]} onRevoke={() => {}} />);

    expect(screen.getByText('14/12/2099')).toBeTruthy();
    expect(screen.getByText('19/09/2026')).toBeTruthy();
    expect(screen.queryByText(/T\d\d:\d\d/)).toBeNull();
  });

  it('a token never used says so', () => {
    render(<TokenTable tokens={[token()]} onRevoke={() => {}} />);

    expect(screen.getByText('Sin usar')).toBeTruthy();
  });

  it('states are said in words: active, expired and revoked', () => {
    render(
      <TokenTable
        tokens={[token({ id: 'a', name: 'vivo' }), token({ id: 'b', name: 'viejo', expiresAt: '2020-01-01T00:00:00.000Z' }), token({ id: 'c', name: 'caido', revokedAt: '2026-01-01T00:00:00.000Z' })]}
        onRevoke={() => {}}
      />,
    );

    expect(within(screen.getByRole('row', { name: /vivo/ })).getByText('Activo')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /viejo/ })).getByText('Vencido')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /caido/ })).getByText('Revocado')).toBeTruthy();
  });

  it('offers to revoke only what is still alive', async () => {
    const onRevoke = vi.fn();
    render(<TokenTable tokens={[token({ id: 'a', name: 'vivo' }), token({ id: 'c', name: 'caido', revokedAt: '2026-01-01T00:00:00.000Z' })]} onRevoke={onRevoke} />);

    expect(within(screen.getByRole('row', { name: /caido/ })).queryByRole('button', { name: /Revocar/ })).toBeNull();
    await userEvent.click(within(screen.getByRole('row', { name: /vivo/ })).getByRole('button', { name: /Revocar/ }));

    expect(onRevoke).toHaveBeenCalledWith('a');
  });

  it('names each revoke button after its token, so a screen reader can tell them apart', () => {
    render(<TokenTable tokens={[token({ id: 'a', name: 'uno' }), token({ id: 'b', name: 'dos' })]} onRevoke={() => {}} />);

    expect(screen.getByRole('button', { name: 'Revocar uno' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revocar dos' })).toBeTruthy();
  });
});

describe('TokenSecretPanel (WO-580, SDD-056)', () => {
  it('says the secret will not be shown again, and shows it as copyable text', () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    render(<TokenSecretPanel secret="prdm_ci_abcd.SECRET" onDismiss={() => {}} />);

    expect(screen.getByText('Token creado')).toBeTruthy();
    expect(screen.getByText(/no lo vamos a volver a mostrar/)).toBeTruthy();
    expect(screen.getByText('prdm_ci_abcd.SECRET')).toBeTruthy();
  });

  it('copies exactly the secret', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TokenSecretPanel secret="prdm_ci_abcd.SECRET" onDismiss={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(writeText).toHaveBeenCalledWith('prdm_ci_abcd.SECRET');
  });

  it('is dismissed by the person, and only by the person', async () => {
    const onDismiss = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true });
    render(<TokenSecretPanel secret="s" onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Ya lo guardé' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is announced when it appears, because the secret is not recoverable', () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true });
    render(<TokenSecretPanel secret="s" onDismiss={() => {}} />);

    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
