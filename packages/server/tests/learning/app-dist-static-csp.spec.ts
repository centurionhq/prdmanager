/**
 * Learning test — ADR-008 / WO-320.
 *
 * ADR-008 ports Centurion Factory's self-hosted `@fontsource` fonts and CSS Modules into `packages/app`.
 * Before touching any of that (WO-321+), this spec answers the actual open question: does the real
 * server's CSP (`packages/server/src/security-headers.ts`: `style-src 'self' 'nonce-...'`, `font-src
 * 'self'`, no `unsafe-inline` anywhere) already let `packages/app/dist` load cleanly, with zero
 * `securitypolicyviolation` events, when served by the real `buildServer()` rather than Vite's dev
 * server (which has no CSP at all and would hide a real-world violation)?
 *
 * FOUND (this run, against `packages/app`'s pre-ADR-008 bundle — plain CSS files via `<link
 * rel="stylesheet">` from Vite's own build, no inline `<style>`, no external font `@import`, tokens from
 * `@prdm/ui/styles/tokens.css`): zero violations. Vite's production build already emits a hashed,
 * same-origin `<link rel="stylesheet">` for every CSS Module (no inline `<style>` tag, so the CSP's
 * `style-src` nonce is never even exercised by this bundle yet) and the CSS itself makes no network
 * requests, so `font-src 'self'` is never hit either. This is the correct baseline: once WO-321 ports
 * `@fontsource-variable/archivo` and `@fontsource/ibm-plex-mono` (self-hosted, bundled into `dist/assets`
 * by Vite the same way any other static import is, per ADR-007), the fonts become same-origin `dist`
 * assets too, so this same zero-violations assertion should keep holding — this spec is the CI-enforced
 * regression guard for that claim, run once now (before the port) and again by every future CI run
 * (after it).
 *
 * Deliberately the lightest real-server setup this repo has for a Playwright spec: unlike
 * `codemirror-csp-nonce.spec.ts` (which needs a full `startJourney` — Postgres, Neo4j, a seeded org and
 * project — because it exercises the authenticated document editor), this spec only ever loads the
 * public, unauthenticated `/login` route, so it needs nothing but a real Postgres pool (per
 * `csrf-and-headers.test.ts`'s own lighter `buildServer` setup) for `buildServer` to construct its
 * better-auth wiring — no Neo4j, no seeded users, no login attempt.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openTestPg, type PgTestDb } from '@prdm/testkit';
import { expect, test } from '@playwright/test';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const APP_DIST = fileURLToPath(new URL('../../../app/dist', import.meta.url));
const PORT = 4656;
const BASE_URL = `http://127.0.0.1:${PORT}`;

test('packages/app/dist loads under the real CSP with zero securitypolicyviolation events', async ({ page }) => {
  if (!existsSync(APP_DIST)) {
    throw new Error(`@prdm/app bundle not found at ${APP_DIST}; run "npm run build --workspace=@prdm/app" first`);
  }

  const pg: PgTestDb = await openTestPg();
  const env = buildTestServerEnv({ publicUrl: BASE_URL, trustedOrigins: [BASE_URL] });
  const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, staticDir: APP_DIST });

  try {
    await app.ready();
    await app.listen({ port: PORT, host: '127.0.0.1' });

    const consoleViolations: string[] = [];
    page.on('console', (msg) => {
      if (/refused to (apply|load|execute)/i.test(msg.text()) || /content security policy/i.test(msg.text())) {
        consoleViolations.push(msg.text());
      }
    });
    page.on('pageerror', (err) => consoleViolations.push(String(err)));

    // Installed before navigation (a `securitypolicyviolation` DOM event catches a violation even in a
    // browser that never also logs a matching console message for it — same technique as
    // codemirror-csp-nonce.spec.ts).
    await page.addInitScript(() => {
      const browserGlobal = globalThis as unknown as { __cspViolations: string[]; document: { addEventListener: (type: string, listener: (event: any) => void) => void } }; // eslint-disable-line @typescript-eslint/no-explicit-any
      browserGlobal.__cspViolations = [];
      browserGlobal.document.addEventListener('securitypolicyviolation', (event) => {
        browserGlobal.__cspViolations.push(
          `${event.violatedDirective}: ${event.blockedURI} @ ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} sample=${event.sample}`,
        );
      });
    });

    const response = await page.goto(`${BASE_URL}/login`);
    const cspHeader = response?.headers()['content-security-policy'] ?? '';
    expect(cspHeader).toMatch(/style-src 'self' 'nonce-[^']+'/);
    expect(cspHeader).toContain("font-src 'self'");
    expect(cspHeader).not.toContain('unsafe-inline');

    await expect(page.getByRole('heading', { name: 'Entrá a tu organización' })).toBeVisible();

    const domViolations = await page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
    expect(domViolations).toEqual([]);
    expect(consoleViolations).toEqual([]);
  } finally {
    await app.close();
    await pg.close();
  }
});
