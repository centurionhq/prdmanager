import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { RootRedirect } from '../../src/routes/RootRedirect.js';

function renderRoot() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <RootRedirect /> },
      { path: '/login', element: <p>login screen</p> },
      { path: '/o/:orgSlug', element: <p>org dashboard</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

describe('RootRedirect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to /login when there is no session', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    renderRoot();

    expect(await screen.findByText('login screen')).toBeTruthy();
  });

  it('redirects to the first organization when signed in with organizations', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'a@example.test', name: 'A' } });
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([
      { id: 'org1', slug: 'acme', name: 'Acme', role: 'owner' },
      { id: 'org2', slug: 'other', name: 'Other', role: 'member' },
    ]);
    renderRoot();

    expect(await screen.findByText('org dashboard')).toBeTruthy();
  });

  it('shows a message when signed in with no organizations', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'a@example.test', name: 'A' } });
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([]);
    renderRoot();

    expect(await screen.findByText(/no pertenecés a ninguna organización/i)).toBeTruthy();
  });
});
