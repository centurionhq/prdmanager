/**
 * WO-745 (SDD-103 WO-B, gate): a render error on Órdenes, forced in a real browser, must stay contained
 * inside the chrome — sidebar and navigation survive, the plate explains the failure in plain language
 * with its copyable `ERR-…` code, no engine text/stack reaches the DOM, and once the cause is gone
 * «Reintentar» draws the real rows again. Same real-server harness and failing CSP listener as
 * `planta-entrada-ordenes.spec.ts`.
 *
 * Forced payload (the interceptor on `**\/graph/work-orders*`):
 *
 *   { items: 42, total: 1, statusCounts: { all: 1, pending: 1, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 } }
 *
 * Why it throws DURING RENDER (not a network error, not the screen's own error state):
 * - `packages/app/src/api/request.ts` returns `body as T`: the client casts the response without validating
 *   it, so a 200 with an unexpected envelope reaches the screen raw.
 * - `Ordenes.tsx` does `const items = data?.items ?? []` → `42` (neither null nor undefined), then
 *   `sortWorkOrders(items, sort)` → `sortItems` (`lib/filter-sort.ts`) calls `items.map(...)` →
 *   `TypeError: items.map is not a function` while rendering. The route's `errorElement` catches it;
 *   `ErrorState` is only drawn for `listQuery.status === 'error'`, and here the query was a 200 OK.
 * It is the very signature of FB-189 (`e.filter is not a function` behind a 200).
 *
 * Recovery rows are real: work orders are seeded into the project's graph through core's real parser
 * (`scanContents`) and the same store/root the server reads (`saas://project/<id>`), never a network mock.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanContents } from '@prdm/core';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;

const SHOTS_DIR = fileURLToPath(new URL('../../test-results/', import.meta.url));
const WORK_ORDERS_ROUTE = '**/graph/work-orders*';
const ERROR_CODE = /^ERR-[0-9A-F]{4}-[0-9A-F]{4}$/;

function workOrderDoc(n: number): { path: string; content: string } {
  const id = `WO-00${n}`;
  return {
    path: `docs/work-orders/${id}.md`,
    content: `---\nid: ${id}\ntype: WO\ntitle: Orden de la prueba ${n}\nstatus: pending\nimplements: [SDD-001]\n---\nCuerpo.\n`,
  };
}

test.beforeAll(async () => {
  journey = await startJourney();
  const store = journey.neo4j.forProject({
    id: journey.project.graphProjectId,
    name: 'error-de-render-e2e',
    root: `saas://project/${journey.project.id}`,
  });
  const scan = scanContents([
    {
      path: 'docs/blueprints/SDD-001.md',
      content:
        '---\nid: SDD-001\ntype: SDD\ntitle: Pantalla de órdenes\nstatus: approved\nimpacts_paths: ["packages/app/src/routes/Ordenes.tsx"]\n---\n## Tareas\n\n- [ ] Una orden sembrada\n',
    },
    workOrderDoc(1),
    workOrderDoc(2),
    workOrderDoc(3),
  ]);
  await store.writeSnapshot({ docs: scan.docs, governed: [], reviewNeeded: [], commits: [] });
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

async function login(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/o\//);
}

/** Same technique as `planta-entrada-ordenes.spec.ts`: any CSP violation fails the test. */
async function installCspViolationListener(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const browserGlobal = globalThis as unknown as {
      __cspViolations: string[];
      document: { addEventListener: (type: string, listener: (event: SecurityPolicyViolationEvent) => void) => void };
    };
    browserGlobal.__cspViolations = [];
    browserGlobal.document.addEventListener('securitypolicyviolation', (event) => {
      browserGlobal.__cspViolations.push(`${event.violatedDirective}: ${event.blockedURI} @ ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`);
    });
  });
  page.on('console', (msg) => {
    if (/refused to (apply|load|execute)/i.test(msg.text()) || /content security policy/i.test(msg.text())) {
      throw new Error(`unexpected CSP-related console message: ${msg.text()}`);
    }
  });
}

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
}

test('Órdenes: un error de render queda dentro del chrome, explica el fallo y Reintentar recupera las filas (WO-745)', async ({ browser }) => {
  test.setTimeout(120_000);
  const { baseUrl, org, project, alice } = journey;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleMessages: string[] = [];
  page.on('console', (msg) => consoleMessages.push(msg.text()));
  await installCspViolationListener(page);
  await login(page, baseUrl, alice.email);

  await test.step('las órdenes sembradas existen de verdad contra el backend real', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ordenes`);
    await expect(page.getByRole('heading', { level: 1, name: 'Órdenes de trabajo' })).toBeVisible();
    await expect(page.getByRole('row', { name: /WO-00\d/ }).first()).toBeVisible();
  });

  await page.route(WORK_ORDERS_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: 42,
        total: 1,
        statusCounts: { all: 1, pending: 1, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 },
      }),
    }),
  );
  await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ordenes`);

  let screenCode = '';
  await test.step('la placa aparece y el chrome sobrevive', async () => {
    await expect(page.getByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    const destinos = page.getByRole('navigation', { name: 'Destinos del proyecto' });
    await expect(destinos).toBeVisible();
    await expect(destinos.getByRole('link', { name: 'Ir a la Planta' })).toBeVisible();
    await expect(destinos.getByRole('link', { name: 'Ir a Documentos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();

    const code = page.getByRole('group', { name: 'Código del error' }).getByText(ERROR_CODE);
    await expect(code).toBeVisible();
    screenCode = ((await code.textContent()) ?? '').trim();
    expect(screenCode).toMatch(ERROR_CODE);
  });

  await test.step('nada del motor a la vista', async () => {
    await expect(page.getByText(/Unexpected Application Error/)).toHaveCount(0);
    await expect(page.getByRole('note')).toHaveCount(0);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('items.map is not a function');
    expect(bodyText).not.toContain('TypeError');
    expect(bodyText).not.toContain('at http');
  });

  await test.step('la consola lleva el mismo código que la placa', async () => {
    expect(consoleMessages.some((text) => text.startsWith(`[route-error] ${screenCode}`))).toBe(true);
  });

  await test.step('captura a 1440 px sin violaciones de CSP', async () => {
    expect(await cspViolations(page)).toEqual([]);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOTS_DIR}error-de-render-1440.png`, fullPage: true });
  });

  await test.step('captura a 375 px con la placa en pantalla, sin violaciones de CSP', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOTS_DIR}error-de-render-375.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('liberada la intercepción, Reintentar dibuja las filas reales', async () => {
    let workOrderRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/graph/work-orders')) workOrderRequests += 1;
    });
    await page.unroute(WORK_ORDERS_ROUTE);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect
      .poll(() => workOrderRequests, { message: '«Reintentar» tiene que volver a pedir las órdenes al servidor', timeout: 5_000 })
      .toBeGreaterThan(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Órdenes de trabajo' })).toBeVisible();
    await expect(page.getByRole('row', { name: /WO-00\d/ }).first()).toBeVisible();
  });

  expect(await cspViolations(page)).toEqual([]);
  await context.close();
});
