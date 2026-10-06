/**
 * WO-566 (SDD-054/FB-033): the document's three columns start on the same line, in a real browser.
 *
 * The bug this guards against was invisible to every unit test: nothing was broken in the markup, the left
 * column simply had no body of its own, so it began wherever its first line of text happened to fall while the
 * editor and the side panel began at their own card's top edge. What is asserted here is therefore geometry --
 * the top of each of the three columns -- for a business case (which has the writing guide) and for a document
 * that is not one (which has only the frontmatter fields).
 */
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;

test.beforeAll(async () => {
  journey = await startJourney();
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

async function login(page: Page): Promise<void> {
  await page.goto(`${journey.baseUrl}/login`);
  await page.getByLabel('Email').fill(journey.alice.email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/o\//);
}

/** Creates a document through the real API with the browser's own session, so this spec stays about layout. */
async function createDocument(page: Page, kind: string, title: string): Promise<string> {
  const base = `/api/app/organizations/${journey.org.slug}/projects/${journey.project.slug}`;
  return page.evaluate(
    async ({ base, kind, title }) => {
      // Same double-submit handshake the app's own `request.ts` does before any mutating /api/app call.
      const { token } = await fetch('/api/app/csrf-token', { credentials: 'include', headers: { Accept: 'application/json' } }).then((r) => r.json());
      const res = await fetch(`${base}/documents`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ kind, title }),
      });
      if (!res.ok) throw new Error(`${kind}: ${res.status} ${await res.text()}`);
      return (await res.json()).document.docId as string;
    },
    { base, kind, title },
  );
}

/** The tops of the three children of the document's grid, found from the editor upwards -- no test-only hook
 * in the app for something that is purely about how it is laid out. */
async function columnTops(page: Page): Promise<{ sidebar: number; editor: number; panel: number }> {
  const tops = await page.evaluate(() => {
    const visibleEditor = Array.from(document.querySelectorAll('[data-testid="collab-editor-container"]')).find((el) => (el as HTMLElement).offsetParent !== null);
    let node: HTMLElement | null = visibleEditor as HTMLElement | null;
    while (node && getComputedStyle(node).display !== 'grid') node = node.parentElement;
    return Array.from(node?.children ?? []).map((el) => Math.round(el.getBoundingClientRect().top));
  });
  return { sidebar: tops[0] ?? -1, editor: tops[1] ?? -2, panel: tops[2] ?? -3 };
}

test('las tres columnas del documento arrancan en la misma línea, con guía y sin ella', async ({ page }) => {
  await login(page);
  const project = `${journey.baseUrl}/o/${journey.org.slug}/p/${journey.project.slug}`;

  const bcId = await createDocument(page, 'BC', 'Que arrancar no frene el trabajo');
  const prdId = await createDocument(page, 'PRD', 'Aviso de orden atrasada');

  // 1) Un caso de negocio: la columna es un cuerpo con su barra, y la guía vive adentro.
  await page.goto(`${project}/documents/${bcId}`);
  await expect(page.getByRole('tab', { name: 'Vista previa' })).toBeVisible();
  const guia = page.getByRole('complementary', { name: 'Guía del caso de negocio' });
  await expect(guia).toBeVisible();
  const conGuia = await columnTops(page);
  expect(Math.abs(conGuia.sidebar - conGuia.editor)).toBeLessThanOrEqual(1);
  expect(Math.abs(conGuia.panel - conGuia.editor)).toBeLessThanOrEqual(1);

  // La barra de la guía tiene la misma altura que la del editor: por eso arrancan alineadas de verdad.
  const alturaCabecera = await guia.locator('> div').first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(alturaCabecera).toBe(44);

  // El frontmatter está en el mismo cuerpo que la guía, no flotando debajo.
  const mismoCuerpo = await page.getByLabel('Justificado por').evaluate((input, aside) => aside?.parentElement?.contains(input) ?? false, await guia.elementHandle());
  expect(mismoCuerpo).toBe(true);

  // 2) Un documento que no es un caso de negocio: sin guía, y la columna sigue siendo un cuerpo alineado.
  await page.goto(`${project}/documents/${prdId}`);
  await expect(page.getByRole('tab', { name: 'Vista previa' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Guía del caso de negocio' })).toHaveCount(0);
  const sinGuia = await columnTops(page);
  expect(Math.abs(sinGuia.sidebar - sinGuia.editor)).toBeLessThanOrEqual(1);
  expect(Math.abs(sinGuia.panel - sinGuia.editor)).toBeLessThanOrEqual(1);

  // 3) A 390 px las columnas se apilan: alinearlas no puede haber roto el ancho de teléfono.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${project}/documents/${bcId}`);
  await expect(page.getByRole('complementary', { name: 'Guía del caso de negocio' })).toBeVisible();
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde).toBeLessThanOrEqual(0);
});
