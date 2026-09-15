import { Outlet } from 'react-router';
import { ToastProvider } from '../ToastProvider/ToastProvider';
import { useDocumentTitle } from './useDocumentTitle';

/**
 * Top-level route element: every screen (inside or outside the app shell) can raise toasts, and
 * gets its document title from the route's `handle.title` (SDD-011 "título por ruta"), including
 * /login and /proyectos which render outside the AppShell.
 */
export function RootLayout() {
  useDocumentTitle();

  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}
