/**
 * WO-669: the Planta's commit KPIs ("Commits trazados", "Commits con Refs") are controls that open a
 * drawer with the metric's definition and the commits behind it, exercised in the *real* app at 375 px.
 * Sister of `planta-kpi-375.spec.ts` (same harness, same login, same seed); it duplicates that spec's
 * helpers on purpose so each file stays self-contained.
 *
 * Why the metrics response is intercepted: the journey's project is brand new and has no commits, so both
 * commit KPIs honestly read "Sin datos" (nothing to open). To exercise the UI, the spec intercepts
 * the project's metrics endpoint (see `context.route` below), performs the real request with `route.fetch()`,
 * replaces `body.traceability` with a fixture shaped like WO-668's, and fulfills with that. The fixture
 * keeps the invariants (`untracedCommits.total === commitsTotal - commitsTraced` -> 119 = 544 - 425, and
 * `danglingRefs === commitsWithRefs - commitsTraced` -> 2 = 427 - 425). It is NOT real data.
 *
 * Why the overview response is intercepted too: the journey's project also has no CI report, so
 * `project.awaitingFirstReport === true` and the strip shows «Esperando el primer reporte de CI» instead of
 * the five values; they (and their controls) are never drawn. The spec therefore also intercepts
 * `GET .../projects/overview`, performs the real request and sets `awaitingFirstReport: false` on every project.
 * These two are the only intervened responses; everything else (session, timeline, documents) is real.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectNoViolations } from './accessibility-helpers.js';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;

const SCREENSHOT_PATH = fileURLToPath(new URL('../../test-results/planta-kpi-detalle-375.png', import.meta.url));
const SCREENSHOT_WIDTH_1440_PATH = fileURLToPath(new URL('../../test-results/planta-kpi-detalle-1440.png', import.meta.url));

const FIRST_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const DANGLING_SHA = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';

interface FixtureItem {
  sha: string;
  subject: string;
  author: string;
  date: string;
  files: string[];
  gap: 'no_refs' | 'dangling_refs';
}

/** 20 items: 18 `no_refs` (the first with the known sha/subject) + 2 `dangling_refs`. */
function buildUntracedItems(): FixtureItem[] {
  const noRefs: FixtureItem[] = Array.from({ length: 18 }, (_, i) => ({
    sha: i === 0 ? FIRST_SHA : `${(i + 1).toString(16).padStart(2, '0')}c0ffee${i.toString(16).padStart(2, '0')}`.padEnd(40, '9'),
    subject: i === 0 ? 'feat: la Planta abre su lista de commits' : `chore: cambio sin trailer ${i}`,
    author: i % 2 === 0 ? 'Ana Ríos' : 'Luis Mora',
    date: new Date(Date.UTC(2026, 8, 30 - (i % 20), 12, i)).toISOString(),
    files: Array.from({ length: i % 4 }, (_, f) => `packages/app/src/archivo-${i}-${f}.ts`),
    gap: 'no_refs',
  }));
  const dangling: FixtureItem[] = [
    { sha: DANGLING_SHA, subject: 'fix: ref que no resuelve', author: 'Ana Ríos', date: '2026-09-28T10:00:00.000Z', files: ['packages/core/src/ref.ts'], gap: 'dangling_refs' },
    { sha: 'd4d4d4d4b5b5b5b5c6c6c6c6e7e7e7e7f8f8f8f8', subject: 'fix: otra ref colgante', author: 'Luis Mora', date: '2026-09-27T10:00:00.000Z', files: [], gap: 'dangling_refs' },
  ];
  return [...noRefs, ...dangling];
}

const TRACEABILITY_FIXTURE = {
  commitsTotal: 544,
  commitsWithRefs: 427,
  commitsTraced: 425,
  commitPercent: 78.1,
  featuresTotal: 46,
  featuresTraced: 21,
  orphanFeatures: [],
  featurePercent: 45.7,
  untracedCommits: { total: 119, danglingRefs: 2, truncated: true, items: buildUntracedItems() },
};

test.beforeAll(async () => {
  journey = await startJourney();
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

/** Product order (WO-648 D1), left→right. */
const KPI_LABELS = ['Resolución mediana de una orden', 'Código sincronizado', 'Features trazadas', 'Commits trazados', 'Commits con Refs'];

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

test('el KPI de commits abre su drill-down y Escape lo cierra (WO-669)', async ({ browser }) => {
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

  await context.route('**/api/app/organizations/*/projects/*/metrics', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, traceability: TRACEABILITY_FIXTURE } });
  });

  await context.route('**/api/app/organizations/*/projects/overview', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(body.projects)) {
      await route.fulfill({ response });
      return;
    }
    const projects = (body.projects as Record<string, unknown>[]).map((p) => ({ ...p, awaitingFirstReport: false }));
    await route.fulfill({ response, json: { ...body, projects } });
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
  await expect(page.getByText(bcDocId)).toBeVisible();

  const strip = page.getByRole('region', { name: 'Indicadores de la planta' });
  await expect(strip).toBeVisible();
  for (const label of KPI_LABELS) {
    // `.first()`: el <h2> del drawer cerrado (dentro de la celda) repite el label en el DOM; el <span> del label lo precede.
    await expect(strip.getByText(label, { exact: true }).first()).toBeVisible();
  }
  const kpi = strip.getByRole('button', { name: 'Commits con Refs: 427/544' });
  const tracedKpi = strip.getByRole('button', { name: 'Commits trazados: 425/544' });
  await expect(kpi).toBeVisible();
  await expect(kpi).toHaveAttribute('aria-expanded', 'false');
  await expect(tracedKpi).toBeVisible();

  await test.step('«Commits con Refs» abre su drawer sólo con los no_refs; Escape lo cierra y devuelve el foco', async () => {
    await kpi.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(kpi).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByText('Commits cuyo mensaje lleva el trailer Refs:; la lista son los que no lo llevan.')).toBeVisible();
    await expect(dialog.getByText('117 de 544 commits sin el trailer Refs:')).toBeVisible();
    await expect(dialog.getByText('a1b2c3d')).toBeVisible();
    await expect(dialog.getByText('Se muestran los primeros 20 de 119.')).toBeVisible();
    await expect(dialog.getByText('f0e1d2c')).toHaveCount(0);

    mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    await expectNoViolations(page, 'Planta · drawer «Commits con Refs» (375)');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(kpi).toHaveAttribute('aria-expanded', 'false');
    await expect(kpi).toBeFocused();
  });

  await test.step('«Commits trazados» también lista los commits con ref colgante', async () => {
    await tracedKpi.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('119 de 544 commits sin trazar')).toBeVisible();
    await expect(dialog.getByText('2 refs colgantes')).toBeVisible();
    await expect(dialog.getByText('f0e1d2c')).toBeVisible();
    await expect(dialog.getByText('ref colgante').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(tracedKpi).toBeFocused();
  });

  await test.step('a 1440 px el drawer de «Commits trazados» abierto no tiene violaciones de axe', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    await expect(page.getByText(bcDocId)).toBeVisible();

    const tracedKpi1440 = page.getByRole('region', { name: 'Indicadores de la planta' }).getByRole('button', { name: 'Commits trazados: 425/544' });
    await tracedKpi1440.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('f0e1d2c')).toBeVisible();
    await expect(dialog.getByText('ref colgante').first()).toBeVisible();
    await expectNoViolations(page, 'Planta · drawer «Commits trazados» (1440)');

    mkdirSync(dirname(SCREENSHOT_WIDTH_1440_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_WIDTH_1440_PATH, fullPage: true });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
