import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverPort = process.env['PRDM_SERVER_PORT'] ?? '4601';
const target = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // `changeOrigin: true` rewrites the proxied request's own Host header to match `target` (packages/web's
      // own vite.config.ts proxy predates this and never set it — a real, documented gap this config doesn't
      // repeat, since packages/server's own Host allowlist otherwise rejects the request).
      '/api': { target, changeOrigin: true },
      '/collab': { target, changeOrigin: true, ws: true },
      '/mcp': { target, changeOrigin: true },
    },
  },
});
