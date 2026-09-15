import { Outlet } from 'react-router';
import { ToastProvider } from '../ToastProvider/ToastProvider';

/** Top-level route element: every screen (inside or outside the app shell) can raise toasts. */
export function RootLayout() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}
