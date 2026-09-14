import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { AdminOrganizations } from '../../src/routes/AdminOrganizations.js';

describe('AdminOrganizations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists existing organizations', async () => {
    vi.spyOn(client, 'listAllOrganizationsAsSuperadmin').mockResolvedValue([
      { id: 'org1', slug: 'acme', name: 'Acme' },
      { id: 'org2', slug: 'globex', name: 'Globex' },
    ]);
    render(<AdminOrganizations />);

    expect(await screen.findByText('Acme')).toBeTruthy();
    expect(screen.getByText('globex')).toBeTruthy();
  });

  it('shows a message when the caller is forbidden (not a verified superadmin)', async () => {
    vi.spyOn(client, 'listAllOrganizationsAsSuperadmin').mockRejectedValue(
      new client.ApiClientError(403, 'forbidden', 'forbidden'),
    );
    render(<AdminOrganizations />);

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('validates the create form before submitting', async () => {
    vi.spyOn(client, 'listAllOrganizationsAsSuperadmin').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createOrganizationAsSuperadmin');
    render(<AdminOrganizations />);

    await screen.findByRole('heading', { name: 'Nueva organización' });
    await userEvent.type(screen.getByLabelText('Slug'), 'Not Valid!');
    await userEvent.click(screen.getByRole('button', { name: 'Crear organización' }));

    expect(await screen.findByText(/Minúsculas, números y guiones/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates an organization, shows the DeepSeek-processing disclosure, and lists the new org', async () => {
    vi.spyOn(client, 'listAllOrganizationsAsSuperadmin').mockResolvedValue([]);
    const create = vi
      .spyOn(client, 'createOrganizationAsSuperadmin')
      .mockResolvedValue({ organizationId: 'org3', slug: 'new-org', invitationId: 'inv1' });
    render(<AdminOrganizations />);

    await screen.findByText(/Todavía no se creó ninguna organización/);
    await userEvent.type(screen.getByLabelText('Nombre'), 'New Org');
    await userEvent.type(screen.getByLabelText('Slug'), 'new-org');
    await userEvent.type(screen.getByLabelText('Email del owner'), 'owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Crear organización' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'New Org', slug: 'new-org', ownerEmail: 'owner@example.test' }));
    expect(await screen.findByText(/procesará automáticamente con DeepSeek/)).toBeTruthy();
    expect(screen.getByText('new-org')).toBeTruthy();
  });
});
