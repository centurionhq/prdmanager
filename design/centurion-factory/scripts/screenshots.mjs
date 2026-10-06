// Captures every route at 1440 and 375 px into screenshots/ (SDD-011 self-critique step).
// Usage: npm run screenshots  (starts a Vite dev server on a free port, then closes it)
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { SCREENSHOT_ROUTES, VIEWPORTS } from './routes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'screenshots');
// Still generous even with reduced motion on: covers the simulated list latency (400ms).
const SETTLE_MS = 3000;
// The fixed bottom bar would otherwise paint mid-page on a full-page mobile capture, since
// full-page screenshots scroll the viewport while `position: fixed` elements stay pinned.
const HIDE_BOTTOM_BAR_CSS = 'nav[aria-label="Navegación móvil"]{position:static!important}';

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await createServer({ root, server: { port: 0, strictPort: false, watch: null }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo obtener el puerto del servidor de Vite');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
      });
      page.on('pageerror', (error) => failures.push(`${viewport.name} ${page.url()}: ${error.message}`));
      for (const route of SCREENSHOT_ROUTES) {
        await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(SETTLE_MS);
        if (route.click) {
          await page.getByRole('button', { name: route.click }).click();
          await page.waitForTimeout(SETTLE_MS);
        }
        if (viewport.name === 'mobile') await page.addStyleTag({ content: HIDE_BOTTOM_BAR_CSS });
        const file = join(outDir, `${route.name}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`captured ${file}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (failures.length > 0) {
    console.error(`Errores de página:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
