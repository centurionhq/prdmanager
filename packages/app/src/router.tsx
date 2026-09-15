// SDD-006 "Dashboard (shell)": react-router 8.3.1 in data mode. `createBrowserRouter`/`RouterProvider` are both
// exported from the top-level `react-router` package (v7+ absorbed what used to be `react-router-dom`; verified
// against `node_modules/react-router`'s own `dist/production/index.d.ts` rather than assumed) — there is no
// separate `react-router-dom` dependency in this package.
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AdminOrganizations } from './routes/AdminOrganizations.js';
import { DocumentDetail } from './routes/DocumentDetail.js';
import { DocumentsList } from './routes/DocumentsList.js';
import { DriftDashboard } from './routes/DriftDashboard.js';
import { InviteAccept } from './routes/InviteAccept.js';
import { Login } from './routes/Login.js';
import { OrgMembersSettings } from './routes/OrgMembersSettings.js';
import { OrgShell } from './routes/OrgShell.js';
import { PersonalTokensSettings } from './routes/PersonalTokensSettings.js';
import { ProjectGraph } from './routes/ProjectGraph.js';
import { ProjectsDashboard } from './routes/ProjectsDashboard.js';
import { ProjectSettings } from './routes/ProjectSettings.js';
import { ResetPassword } from './routes/ResetPassword.js';
import { RootRedirect } from './routes/RootRedirect.js';

export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/invite/:id', element: <InviteAccept /> },
  { path: '/settings/tokens', element: <PersonalTokensSettings /> },
  { path: '/admin', element: <AdminOrganizations /> },
  {
    path: '/o/:orgSlug',
    element: <OrgShell />,
    children: [
      { index: true, element: <ProjectsDashboard /> },
      { path: 'settings/members', element: <OrgMembersSettings /> },
      { path: 'p/:projectSlug/settings', element: <ProjectSettings /> },
      { path: 'p/:projectSlug/documents', element: <DocumentsList /> },
      { path: 'p/:projectSlug/documents/:docId', element: <DocumentDetail /> },
      { path: 'p/:projectSlug/graph', element: <ProjectGraph /> },
      { path: 'p/:projectSlug/drift', element: <DriftDashboard /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
