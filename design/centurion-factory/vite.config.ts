import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ADR-007: isolated design package with mock data only — no proxy, no backend.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
