import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { routes } from '../../src/router';

/** WO-117: "/" no longer renders a static placeholder — it's `RootRedirect`, which sends a signed-out
 * visitor to `/login` (this repo's actual entry point once a session exists is `/o/:orgSlug`, exercised by
 * `RootRedirect.test.tsx` and `OrgShell.test.tsx`). This smoke test only proves the route tree itself wires
 * up and reaches a real screen. */
describe('app router', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects "/" to "/login" for a signed-out visitor', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
  });
});
