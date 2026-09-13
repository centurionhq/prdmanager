// PRD-004 / SDD-005: SPA entry point.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element (#root) not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
