import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './components/shell/AppShell';
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
      { path: 'ajustes', element: <Navigate to="/ajustes/miembros" replace /> },
      { path: 'ajustes/miembros', element: <MiembrosPage />, handle: handle('Ajustes · miembros') },
      { path: 'ajustes/tokens', element: <TokensPage />, handle: handle('Ajustes · tokens de CI') },
      { path: 'ajustes/sso', element: <SsoPage />, handle: handle('Ajustes · autenticación y SSO') },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
