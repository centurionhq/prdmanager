import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { PersonalTokensSettings } from '../../src/routes/PersonalTokensSettings.js';

const TOKEN: import('@prdm/contracts').TokenSummaryDto = {
  id: 'tok1',
  kind: 'personal',
  name: 'laptop',
  prefix: 'prdm_pat_abcd',
  scopes: ['governance:read'],
  expiresAt: '2026-12-31T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('PersonalTokensSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a message when the caller belongs to no organization', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([]);
    render(<PersonalTokensSettings />);

    expect(await screen.findByText(/pertenecer a una organización/)).toBeTruthy();
  });

  it('lists existing tokens for the default (first) organization, never showing a secret', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'owner' }]);
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([TOKEN]);
    render(<PersonalTokensSettings />);

    expect(await screen.findByText('laptop')).toBeTruthy();
    expect(screen.getByText('prdm_pat_abcd')).toBeTruthy();
    expect(screen.queryByText(/secret/i)).toBeNull();
  });

  it('creates a token, shows the secret exactly once, and lists the new token', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'owner' }]);
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createPersonalToken').mockResolvedValue({ token: TOKEN, secret: 'prdm_pat_abcd.SUPERSECRET' });
    render(<PersonalTokensSettings />);

    await screen.findByText(/Todavía no hay tokens/);

    await userEvent.type(screen.getByLabelText('Nombre'), 'laptop');
    await userEvent.click(screen.getByLabelText('governance:read'));
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('acme', expect.objectContaining({ name: 'laptop', scopes: ['governance:read'] })));
    expect(await screen.findByText('prdm_pat_abcd.SUPERSECRET')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText('prdm_pat_abcd.SUPERSECRET')).toBeNull();
  });

  it('requires at least one scope before submitting', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'owner' }]);
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createPersonalToken');
    render(<PersonalTokensSettings />);

    await screen.findByText(/Todavía no hay tokens/);
    await userEvent.type(screen.getByLabelText('Nombre'), 'no-scopes');
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    expect(await screen.findByText(/al menos un scope/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('revokes a token', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'owner' }]);
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([TOKEN]);
    const revoke = vi.spyOn(client, 'revokePersonalToken').mockResolvedValue(undefined);
    render(<PersonalTokensSettings />);

    await userEvent.click(await screen.findByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('acme', 'tok1'));
  });
});
