// SDD-006 "Dashboard (shell)": SPA entry point.
// WO-245: must be the first import — see its own doc comment for why import order matters here.
import './zod-jitless';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
// ADR-008: Centurion Factory's own tokens/base styles (design/centurion-factory/src/styles), the
// canvas-approved visual source of truth, replace @prdm/ui's tokens as this SPA's design system.
import './styles/tokens.css';
import './styles/base.css';
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
