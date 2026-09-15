// SDD-006 "Dashboard (shell)": SPA entry point.
// WO-245: must be the first import — see its own doc comment for why import order matters here.
import './zod-jitless';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import '@prdm/ui/styles/tokens.css';
import { router } from './router';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element (#root) not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
