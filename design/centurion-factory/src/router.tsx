import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './components/shell/AppShell';
import { RootLayout } from './components/shell/RootLayout';
import { AjustesLayout } from './features/ajustes/AjustesLayout';
import { AjustesPlaceholderPage } from './features/ajustes/AjustesPlaceholderPage';
import { MiembrosPage } from './features/ajustes/MiembrosPage';
import { SsoPage } from './features/ajustes/SsoPage';
import { TokensPage } from './features/ajustes/TokensPage';
import { ArbolPage } from './features/arbol/ArbolPage';
import { DocumentoPage } from './features/documento/DocumentoPage';
import { DocumentosPage } from './features/documentos/DocumentosPage';
import { DriftPage } from './features/drift/DriftPage';
import { EntradaPage } from './features/entrada/EntradaPage';
import { LoginPage } from './features/login/LoginPage';
import { OrdenesPage } from './features/ordenes/OrdenesPage';
import { PlantaPage } from './features/planta/PlantaPage';
import { ProyectosPage } from './features/proyectos/ProyectosPage';

/** Route metadata read by the shell to set the document title (SDD-011 "título por ruta"). */
export interface RouteHandle {
  readonly title: string;
}

const handle = (title: string): RouteHandle => ({ title });

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <LoginPage />, handle: handle('Entrar') },
      { path: '/proyectos', element: <ProyectosPage />, handle: handle('Proyectos') },
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <PlantaPage />, handle: handle('Planta') },
          { path: 'arbol/:id?', element: <ArbolPage />, handle: handle('Árbol de features') },
          { path: 'documentos', element: <DocumentosPage />, handle: handle('Documentos') },
          { path: 'documentos/:id', element: <DocumentoPage />, handle: handle('Documento') },
          { path: 'ordenes', element: <OrdenesPage />, handle: handle('Órdenes de trabajo') },
          { path: 'drift', element: <DriftPage />, handle: handle('Drift') },
          { path: 'entrada', element: <EntradaPage />, handle: handle('Bandeja de entrada') },
          {
            path: 'ajustes',
            element: <AjustesLayout />,
            children: [
              { index: true, element: <Navigate to="/ajustes/miembros" replace /> },
              { path: 'general', element: <AjustesPlaceholderPage />, handle: handle('Ajustes · general') },
              { path: 'miembros', element: <MiembrosPage />, handle: handle('Ajustes · miembros') },
              { path: 'tokens', element: <TokensPage />, handle: handle('Ajustes · tokens de CI') },
              { path: 'integraciones', element: <AjustesPlaceholderPage />, handle: handle('Ajustes · integraciones') },
              {
                path: 'miembros-organizacion',
                element: <AjustesPlaceholderPage />,
                handle: handle('Ajustes · miembros de la organización'),
              },
              { path: 'sso', element: <SsoPage />, handle: handle('Ajustes · autenticación y SSO') },
              { path: 'auditoria', element: <AjustesPlaceholderPage />, handle: handle('Ajustes · auditoría') },
              { path: 'perfil', element: <AjustesPlaceholderPage />, handle: handle('Ajustes · perfil') },
              {
                path: 'tokens-personales',
                element: <AjustesPlaceholderPage />,
                handle: handle('Ajustes · tokens personales'),
              },
            ],
          },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];
