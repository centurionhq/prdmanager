import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverPort = process.env['PRDM_SERVER_PORT'] ?? '4601';
const target = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  plugins: [react()],
  // `@prdm/source` (tsconfig.base.json's `customConditions`, the same condition every workspace `dev`/`server`
  // script already runs Node under via `tsx --conditions=@prdm/source`): workspace packages like `@prdm/contracts`
  // and `@prdm/ui` declare that export condition pointing straight at their TS source, so Vite consumes them the
  // same way the rest of the repo does in dev/test — without requiring a `tsc -b` build of every dependency first.
  resolve: {
    conditions: ['@prdm/source'],
    // ADR-006 / ADR-008: Yjs breaks its own instanceof-based struct/type checks if two "equivalent"
    // copies ever load side-by-side — same reason the root vitest.config.ts dedupes it for every package
    // that imports yjs directly.
    dedupe: ['yjs'],
  },
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
