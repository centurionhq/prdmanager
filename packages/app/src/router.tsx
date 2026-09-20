// SDD-006 "Dashboard (shell)" / SDD-013 "Shell y router": react-router 8.3.1 in data mode. `createBrowserRouter`/
// `RouterProvider` are both exported from the top-level `react-router` package (v7+ absorbed what used to be
// `react-router-dom`; verified against `node_modules/react-router`'s own `dist/production/index.d.ts` rather than
// assumed) — there is no separate `react-router-dom` dependency in this package.
//
// ADR-008's route map: `/o/:orgSlug` (Proyectos, org-level ajustes) stays on `OrgShell`; every project screen
// moved under its own `/o/:orgSlug/p/:projectSlug` route (`ProjectShell`, WO-351), which renders the ported
// Centurion Factory `AppShell` instead of `OrgShell`'s own header. Three legacy paths (`/settings/tokens`,
// `.../graph`, `.../settings`) redirect to their new home rather than disappear outright.
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AdminOrganizations } from './routes/AdminOrganizations.js';
import { AjustesAuditoria } from './routes/AjustesAuditoria.js';
import { AjustesGeneral } from './routes/AjustesGeneral.js';
import { AjustesLayout } from './routes/AjustesLayout.js';
import { AjustesMiembros } from './routes/AjustesMiembros.js';
import { AjustesPerfil } from './routes/AjustesPerfil.js';
import { AjustesTokens } from './routes/AjustesTokens.js';
import { ConstruirDeveloper } from './routes/ConstruirDeveloper.js';
import { ConstruirNegocio } from './routes/ConstruirNegocio.js';
import { ConstruirProducto } from './routes/ConstruirProducto.js';
import { DocumentDetail } from './routes/DocumentDetail.js';
import { DocumentsList } from './routes/DocumentsList.js';
import { DriftDashboard } from './routes/DriftDashboard.js';
import { Entrada } from './routes/Entrada.js';
import { InviteAccept } from './routes/InviteAccept.js';
import { Login } from './routes/Login.js';
import { NotFound } from './routes/NotFound.js';
import { Ordenes } from './routes/Ordenes.js';
import { OrgAjustesAuditoria } from './routes/OrgAjustesAuditoria.js';
import { OrgMembersSettings } from './routes/OrgMembersSettings.js';
import { OrgShell } from './routes/OrgShell.js';
import { PersonalTokensSettings } from './routes/PersonalTokensSettings.js';
import { Planta } from './routes/Planta.js';
import { ProjectGraph } from './routes/ProjectGraph.js';
import { ProjectShell } from './routes/ProjectShell.js';
import { ProjectsDashboard } from './routes/ProjectsDashboard.js';
import { ResetPassword } from './routes/ResetPassword.js';
import { RootRedirect } from './routes/RootRedirect.js';
import { SettingsTokensRedirect } from './routes/SettingsTokensRedirect.js';

export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/invite/:id', element: <InviteAccept /> },
  { path: '/admin', element: <AdminOrganizations /> },
  { path: '/settings/tokens', element: <SettingsTokensRedirect /> },
  {
    path: '/o/:orgSlug',
    element: <OrgShell />,
    children: [
      { index: true, element: <ProjectsDashboard /> },
      { path: 'ajustes/miembros', element: <OrgMembersSettings /> },
      { path: 'ajustes/auditoria', element: <OrgAjustesAuditoria /> },
    ],
  },
  {
    path: '/o/:orgSlug/p/:projectSlug',
    element: <ProjectShell />,
    children: [
      { index: true, element: <Planta /> },
      { path: 'construir/negocio', element: <ConstruirNegocio /> },
      { path: 'construir/developer', element: <ConstruirDeveloper /> },
      { path: 'construir/producto', element: <ConstruirProducto /> },
      { path: 'arbol/:id?', element: <ProjectGraph /> },
      { path: 'documents', element: <DocumentsList /> },
      { path: 'documents/:docId', element: <DocumentDetail /> },
      { path: 'ordenes', element: <Ordenes /> },
      { path: 'drift', element: <DriftDashboard /> },
      { path: 'entrada', element: <Entrada /> },
      {
        path: 'ajustes',
        element: <AjustesLayout />,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: 'general', element: <AjustesGeneral /> },
          { path: 'miembros', element: <AjustesMiembros /> },
          { path: 'tokens', element: <AjustesTokens /> },
          { path: 'tokens-personales', element: <PersonalTokensSettings /> },
          { path: 'perfil', element: <AjustesPerfil /> },
          { path: 'auditoria', element: <AjustesAuditoria /> },
        ],
      },
      { path: 'settings', element: <Navigate to="../ajustes/general" replace /> },
      { path: 'graph', element: <Navigate to="../arbol" replace /> },
    ],
  },
  { path: '*', element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
