// SDD-006 "Dashboard (shell)": react-router 8.3.1 in data mode. `createBrowserRouter`/`RouterProvider` are both
// exported from the top-level `react-router` package (v7+ absorbed what used to be `react-router-dom`; verified
// against `node_modules/react-router`'s own `dist/production/index.d.ts` rather than assumed) — there is no
// separate `react-router-dom` dependency in this package.
import { createBrowserRouter, type RouteObject } from 'react-router';
import { InviteAccept } from './routes/InviteAccept.js';
import { Login } from './routes/Login.js';
import { OrgShell } from './routes/OrgShell.js';
import { ProjectsDashboard } from './routes/ProjectsDashboard.js';
import { ResetPassword } from './routes/ResetPassword.js';
import { RootRedirect } from './routes/RootRedirect.js';

export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/invite/:id', element: <InviteAccept /> },
  {
    path: '/o/:orgSlug',
    element: <OrgShell />,
    // WO-118 adds "settings/members" and "p/:projectSlug/settings" as further children here.
    children: [{ index: true, element: <ProjectsDashboard /> }],
  },
];

export const router = createBrowserRouter(routes);
