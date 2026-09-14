// SDD-006 "Dashboard (shell)": react-router 8.3.1 in data mode. `createBrowserRouter`/`RouterProvider` are both
// exported from the top-level `react-router` package (v7+ absorbed what used to be `react-router-dom`; verified
// against `node_modules/react-router`'s own `dist/production/index.d.ts` rather than assumed) — there is no
// separate `react-router-dom` dependency in this package.
import { createBrowserRouter, type RouteObject } from 'react-router';
import type { ReactElement } from 'react';
import { InviteAccept } from './routes/InviteAccept.js';
import { Login } from './routes/Login.js';
import { ResetPassword } from './routes/ResetPassword.js';

/** Placeholder for `/` — WO-117 replaces this with the org switcher / projects dashboard (SDD-006
 * "Dashboard (shell)"). */
function Root(): ReactElement {
  return <p>prdm</p>;
}

export const routes: RouteObject[] = [
  { path: '/', element: <Root /> },
  { path: '/login', element: <Login /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/invite/:id', element: <InviteAccept /> },
];

export const router = createBrowserRouter(routes);
