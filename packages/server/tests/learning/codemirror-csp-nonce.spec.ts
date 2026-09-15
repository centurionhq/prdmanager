/**
 * Learning test — ADR-006 / WO-085.
 *
 * The ADR's own wording asks for a browser-level Playwright check of two libraries under the app's real
 * CSP (`style-src 'self' 'nonce-...'`, no `unsafe-inline`): CodeMirror 6 (`y-codemirror.next`) and
 * Cytoscape. Before writing this test, both halves were re-scoped against what actually shipped:
 *
 *  - **Cytoscape is out of scope.** `grep -rn "cytoscape" packages/app/package.json packages/app/src/`
 *    returns zero matches — the SaaS dashboard built for PRD-005 (`@prdm/app`, this repo's product)
 *    never embeds Cytoscape at all. Only `packages/web` (PRD-004's separate, local, read-only graph
 *    explorer) depends on Cytoscape, and it runs under its *own* server and its own CSP — a different
 *    product, outside SDD-006's tenancy/security boundary. There is nothing to test here for it.
 *  - **CodeMirror's nonce wiring already exists**, added under SDD-008/WO-108, well before this WO: see
 *    `packages/app/src/collab/editor-extensions.ts` — `index.html` carries a per-request
 *    `<meta name="csp-nonce">` (set by `packages/server/src/security-headers.ts`), the client reads it
 *    and calls `EditorView.cspNonce.of(cspNonce)`, which is CodeMirror 6's own documented facet for
 *    exactly this purpose. This WO's actual job is the thing ADR-006 asked for that was still missing:
 *    a real-browser regression test *proving* that wiring holds, plus recording the finding.
 *
 * CONFIRMED (manually, against a real `packages/server/dist/main.js` built from this branch's tip,
 * serving the real `@prdm/app` production build, using a real Chrome browser):
 *  - `curl -sD -` on a real document editor route returns
 *    `content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<...>'; ...`
 *    — no `'unsafe-inline'` anywhere in `style-src`.
 *  - Typing into the CodeMirror body, then selecting text with `Shift+Home`, produced **zero** console
 *    messages matching "Refused" / "Content-Security-Policy" and zero console errors of any kind.
 *
 * This spec automates that same check end to end (real login, real document creation, real typing and
 * selection) so it keeps holding as a CI-enforced regression test, and adds the one thing a manual check
 * can't: a `securitypolicyviolation` DOM event listener installed *before* navigation, which would catch
 * a violation even in the (currently nonexistent) case where a browser doesn't also log it to console.
 */
import { expect, test, type Page } from '@playwright/test';
import { startJourney, stopJourney, PASSWORD, type Journey } from '../e2e/harness.js';

let journey: Journey;

test.beforeAll(async () => {
  journey = await startJourney();
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

async function login(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/o\//);
}

test("CodeMirror 6 + y-codemirror.next inject their styles cleanly under style-src 'self' 'nonce-...', no unsafe-inline", async ({ page }) => {
  const { baseUrl, org, project, alice } = journey;

  const consoleViolations: string[] = [];
  page.on('console', (msg) => {
    if (/refused to (apply|load|execute)/i.test(msg.text()) || /content security policy/i.test(msg.text())) {
      consoleViolations.push(msg.text());
    }
  });
  page.on('pageerror', (err) => consoleViolations.push(String(err)));

  // Real DOM-level event, installed before any navigation: fires even in a browser that doesn't also log
  // a "Refused to..." console message for a given violation. `globalThis`/`any` here (not `window`/
  // `document`) on purpose: this package's tsconfig has no "dom" lib, since it's a Node server package —
  // this callback's body runs in the browser realm, not in this file's own compilation target.
  await page.addInitScript(() => {
    const browserGlobal = globalThis as unknown as { __cspViolations: string[]; document: { addEventListener: (type: string, listener: (event: any) => void) => void } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    browserGlobal.__cspViolations = [];
    browserGlobal.document.addEventListener('securitypolicyviolation', (event) => {
      browserGlobal.__cspViolations.push(
        `${event.violatedDirective}: ${event.blockedURI} @ ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} sample=${event.sample}`,
      );
    });
  });

  await login(page, baseUrl, alice.email);

  const documentsResponse = await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
  const cspHeader = documentsResponse?.headers()['content-security-policy'] ?? '';
  expect(cspHeader).toMatch(/style-src 'self' 'nonce-[^']+'/);
  expect(cspHeader).not.toContain('unsafe-inline');

  await page.getByRole('button', { name: 'Nuevo documento' }).click();
  await page.getByLabel('Tipo de documento').selectOption('PRD');
  await page.getByLabel('Título').fill('WO-085 CSP learning doc');
  await page.getByRole('button', { name: 'Crear' }).click();

  const link = page.getByRole('link', { name: /^PRD-\d+$/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator('.cm-content')).toBeVisible();

  // Exercise the three runtime paths where CodeMirror 6 mounts its own <style> elements: typing (base
  // theme + gutter layout), a text selection (the selection-layer style module), and a blur/refocus
  // cycle (the cursor-blink style module).
  await page.locator('.cm-content').click();
  await page.keyboard.type('WO-085: verifying CodeMirror styles pass the real nonce-based CSP.');
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await page.locator('.cm-content').blur();
  await page.locator('.cm-content').click();
  await expect(page.locator('.cm-content')).toContainText('verifying CodeMirror styles');

  const domViolations = await page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
  expect(domViolations).toEqual([]);
  expect(consoleViolations).toEqual([]);
});
