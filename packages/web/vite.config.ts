import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env['PRDM_WEB_PORT'] ?? '4600';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
