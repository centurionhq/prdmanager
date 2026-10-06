/**
 * WO-648 (SDD-013): the *real* app's Planta KPI band at 375 px, against the real server (never mocked
 * data) — the secondary evidence the design package's own 375 px mock can't give: the app generates the
 * cells from `getMetrics`, and `Planta.module.css`'s `@media (max-width: 767px)` rule is what has to keep
 * the 5th cell full-width once real CSS cascades (`no-hardcoded-hex`-style jsdom tests can't see layout).
 *
 * The KB band only renders once the line board has at least one real row (`Planta.tsx` hides the whole
 * strip behind its `vacio` empty state), so the spec first publishes a minimal real feature the same way
 * a person would: a root `FB` that justifies a `BC`, whose four required sections
 * (`BC_REQUIRED_SECTIONS`) and `justified_by` round-trip through the live collab doc before publishing.
 * That BC is enough for one `caso_negocio` row — a `PRD` (and its own justification dance) would not add
 * anything to what this WO asserts.
 *
 * `GET .../projects/overview` se interviene por la misma razón que en `planta-kpi-detalle-375.spec.ts`: el
 * proyecto del journey no tiene reporte de CI y, con SDD-085 D3, el strip colapsaría a una sola línea.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;

/** Product order (WO-648 D1), left→right. */
const KPI_LABELS = ['Resolución mediana de una orden', 'Código sincronizado', 'Features trazadas', 'Commits trazados', 'Commits con Refs'];

/** Playwright's own conventional, gitignored artifacts dir (`packages/server/test-results/`), resolved
 * from this spec so the capture lands there no matter which directory `playwright test` was run from. */
const SCREENSHOT_PATH = fileURLToPath(new URL('../../test-results/planta-kpi-375.png', import.meta.url));

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
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/o\//);
}

async function switchToMarkdownTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Markdown' }).click();
}

async function switchToValidationTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Validación' }).click();
}

/** A freshly created document's live `Y.Doc` is seeded from that kind's template, so `Control+a` selects
 * that placeholder before typing replaces it (same technique as `planta-entrada-ordenes.spec.ts`). */
async function typeIntoEmptyBody(page: Page, text: string): Promise<void> {
  await switchToMarkdownTab(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    if (line.length > 0) await page.keyboard.type(line);
  }
}

/** Scoped to the "Nuevo documento" dialog: the documents list also has its own search input. */
async function createDocument(page: Page, kind: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Nuevo documento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo de documento').selectOption(kind);
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByRole('button', { name: 'Crear' }).click();
}

/** "Nuevo documento"'s title only seeds the first snapshot, never the live `Y.Doc` this form edits. */
async function fillTitle(page: Page, title: string): Promise<void> {
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Título').blur();
}

async function publishFromReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page.getByRole('button', { name: /^Publicar versión \d+$/ }).click();
}

/** A field write only syncs its local Yjs doc synchronously; a throwaway probe page is a real event that
 * the server has actually persisted it (Hocuspocus only applies, then broadcasts). */
async function waitForFieldOnServer(context: BrowserContext, url: string, label: string, expectedValue: string): Promise<void> {
  const probe = await context.newPage();
  try {
    await probe.goto(url);
    await expect(probe.getByLabel(label)).toHaveValue(expectedValue);
  } finally {
    await probe.close();
  }
}

/** Same idea as {@link waitForFieldOnServer}, for the body editor rather than a frontmatter field. */
async function waitForBodyOnServer(context: BrowserContext, url: string, expectedText: string): Promise<void> {
  const probe = await context.newPage();
  try {
    await probe.goto(url);
    await switchToMarkdownTab(probe);
    await expect(probe.locator('.cm-content')).toContainText(expectedText);
  } finally {
    await probe.close();
  }
}

test('la banda de la Planta a 375 px: 5 KPIs, 2+2 y la 5.ª celda a ancho completo (WO-648)', async ({ browser }) => {
  test.setTimeout(180_000);
  const { baseUrl, org, project, alice } = journey;

  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, baseUrl, alice.email);

  let bcDocId = '';

  await test.step('seed: a published root FB justifies a published BC, so Planta has a real row', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createDocument(page, 'FB', 'La banda de la Planta precisa cinco KPIs');
    const fbLink = page.getByRole('link', { name: /^FB-\d+$/ });
    await expect(fbLink).toBeVisible();
    const fbDocId = (await fbLink.textContent())!.trim();
    await fbLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'La banda de la Planta precisa cinco KPIs' })).toBeVisible();
    await fillTitle(page, 'La banda de la Planta precisa cinco KPIs');
    await page.getByLabel('Fuente').fill('other');
    await page.getByLabel('Fuente').blur();
    // `root: true` keeps a lone feedback from needing an `informs` link to a feature that doesn't exist yet.
    await page.getByLabel('Raíz (excepción de ciclo de vida)').check();
    await typeIntoEmptyBody(page, 'La banda de la Planta precisa mostrar los cinco KPIs de trazabilidad.');
    const fbUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${fbDocId}`;
    await waitForBodyOnServer(context, fbUrl, 'La banda de la Planta precisa mostrar los cinco KPIs de trazabilidad.');
    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createDocument(page, 'BC', 'Caso de negocio: banda de la Planta');
    const bcLink = page.getByRole('link', { name: /^BC-\d+$/ });
    await expect(bcLink).toBeVisible();
    bcDocId = (await bcLink.textContent())!.trim();
    await bcLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Caso de negocio: banda de la Planta' })).toBeVisible();
    await fillTitle(page, 'Caso de negocio: banda de la Planta');
    await page.getByLabel('Justificado por').fill(fbDocId);
    await page.getByLabel('Justificado por').blur();
    await waitForFieldOnServer(context, `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${bcDocId}`, 'Justificado por', fbDocId);

    // The four sections `checkBusinessCase` requires (`BC_REQUIRED_SECTIONS`), typed for real.
    await typeIntoEmptyBody(
      page,
      '## Problema\n\nLa banda de KPIs no muestra los commits trazados.\n\n## Impacto esperado\n\nMenos dudas sobre la trazabilidad del proyecto.\n\n## Métrica de éxito\n\nCinco KPIs visibles sin cortar etiquetas.\n\n## Costo estimado\n\nUna tarde de frontend.',
    );
    const bcUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${bcDocId}`;
    await waitForBodyOnServer(context, bcUrl, 'Una tarde de frontend.');

    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    // `lastValidation` only refreshes on `reload()`, never when the publish dialog opens — see
    // `planta-entrada-ordenes.spec.ts`'s own comment on this exact stale-summary trap.
    await page.reload();
    await switchToValidationTab(page);
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();
  });

  // `route.fetch()` real y se reescribe SÓLO `awaitingFirstReport` (sesión, línea, documentos y `/metrics`
  // siguen siendo reales), igual que en `planta-kpi-detalle-375.spec.ts` (WO-669): sin reporte de CI el
  // strip colapsa a una línea (SDD-085 D3) y los 5 KPIs que mide este spec no existirían.
  let overviewAwaitingFirstReport = false;
  await context.route('**/api/app/organizations/*/projects/overview', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(body.projects)) {
      await route.fulfill({ response });
      return;
    }
    const projects = (body.projects as Record<string, unknown>[]).map((p) => ({ ...p, awaitingFirstReport: overviewAwaitingFirstReport }));
    await route.fulfill({ response, json: { ...body, projects } });
  });

  await test.step('Planta a 375 px: los 5 KPIs en orden y la 5.ª celda a ancho completo', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    // The seeded BC is what makes the strip render at all (an empty line board shows the empty state).
    await expect(page.getByText(bcDocId)).toBeVisible();

    const strip = page.getByRole('region', { name: 'Indicadores de la planta' });
    await expect(strip).toBeVisible();
    for (const label of KPI_LABELS) {
      await expect(strip.getByText(label, { exact: true })).toBeVisible();
    }

    const cells = strip.locator(':scope > div');
    await expect(cells).toHaveCount(5);

    const stripBox = (await strip.boundingBox())!;
    const previousBox = (await cells.nth(3).boundingBox())!;
    const closingBox = (await cells.nth(4).boundingBox())!;
    // D3 (2+2+1): the closing cell is the full content width, not the half-width the 2-column grid gives
    // every other cell in its row.
    expect(closingBox.width).toBeGreaterThan(previousBox.width * 1.8);
    expect(Math.abs(closingBox.width - stripBox.width)).toBeLessThan(4);
    // ...and it closes the band below the other four (a real row break, not a widened column).
    expect(closingBox.y).toBeGreaterThanOrEqual(previousBox.y + previousBox.height - 1);

    mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  });

  await test.step('sin reporte de CI: el primer reporte se dice una sola vez y ofrece conectar el entorno', async () => {
    overviewAwaitingFirstReport = true;
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    await expect(page.getByText(bcDocId)).toBeVisible();

    const strip = page.getByRole('region', { name: 'Indicadores de la planta' });
    const FRASE_PRIMER_REPORTE = 'Todavía no hay reporte de CI: los indicadores llegan con el primero';
    await expect(strip.getByText(FRASE_PRIMER_REPORTE, { exact: true })).toHaveCount(1);

    const conectar = strip.getByRole('link', { name: 'Conectar mi entorno' });
    await expect(conectar).toBeVisible();
    await expect(conectar).toHaveAttribute('href', `/o/${org.slug}/p/${project.slug}/construir/developer`);

    // La banda ya no dibuja los cinco KPIs en esta rama.
    await expect(strip.getByText('Commits con Refs', { exact: true })).toHaveCount(0);
  });
});
