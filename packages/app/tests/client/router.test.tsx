import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { routes } from '../../src/router';

/** WO-112 smoke test: the placeholder `/` route renders "prdm" — real screens land in WO-116+. Uses
 * `createMemoryRouter` (not the real `createBrowserRouter` the app boots with) so this never touches `window.history`. */
describe('app router', () => {
  it('renders the "prdm" placeholder at "/"', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(screen.getByText('prdm')).toBeTruthy();
  });
});
