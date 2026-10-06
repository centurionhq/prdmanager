/**
 * WO-563 (SDD-053/PRD-033 R2): the business path, in a real browser against the real server and database.
 * From the Planta's entry band to a business case that can actually be published:
 *
 *  1. With nothing registered, the screen says so before anything is written and sends the person to the inbox.
 *  2. Once something is registered it is offered, the BC is created chained to it, and the document opens with
 *     the writing guide beside the editor and `justified_by` already filled in -- nobody edits frontmatter.
 *
 * The registered feedback is seeded straight into the database the same way `documents-publish.test.ts` seeds
 * one: the inbox's own registration flow is `Entrada`'s journey, not this one.
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

async function seedRegisteredFeedback(): Promise<void> {
  await journey.pg.ownerPool.query(
    `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
     VALUES ($1, $2, 'FB-901', 'FB', 'Nadie sabe por dónde empezar', 'docs/fb/FB-901.md', 'generated', 'published', $3)
     ON CONFLICT DO NOTHING`,
    [journey.org.id, journey.project.id, '---\nid: FB-901\ntype: FB\ntitle: "Nadie sabe por dónde empezar"\nstatus: new\nroot: true\n---\n\nEl trabajo se frena en encontrar dónde empezar.\n'],
  );
}

test('el camino de negocio: avisa si no hay nada registrado, y después crea el caso ya colgado de eso', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => ((window as unknown as { __csp: string[] }).__csp ??= []).push(e.violatedDirective));
  });

  await login(page);
  const planta = `${journey.baseUrl}/o/${journey.org.slug}/p/${journey.project.slug}`;
  await page.goto(planta);

  // La puerta de la Planta lleva al camino de negocio.
  await page.getByRole('button', { name: /Traigo una necesidad del negocio/ }).click();
  await page.getByRole('region', { name: 'Tu próximo paso' }).getByRole('link', { name: 'Empezar el caso de negocio' }).click();
  await expect(page).toHaveURL(`${planta}/construir/negocio`);
  await expect(page.getByRole('heading', { level: 1, name: '¿De dónde sale esta necesidad?' })).toBeVisible();

  // 1) Sin nada registrado: lo dice antes de escribir, y manda a registrarlo donde ya se registra.
  await expect(page.getByRole('heading', { name: 'Todavía no hay nada registrado de dónde partir' })).toBeVisible();
  await expect(page.getByLabel('¿Qué querés proponer?')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Registrar lo que escuchaste' })).toHaveAttribute('href', `/o/${journey.org.slug}/p/${journey.project.slug}/entrada`);

  // 2) Con algo registrado aparece, y viene elegido.
  await seedRegisteredFeedback();
  await page.reload();
  const plaza = page.getByRole('radiogroup', { name: 'Elegí de dónde sale' }).getByRole('radio', { name: /Nadie sabe por dónde empezar/ });
  await expect(plaza).toHaveAttribute('aria-checked', 'true');
  await expect(plaza).toContainText('FB-901');

  // 3) Crea el caso de negocio: el POST real lleva justified_by y el servidor lo siembra en la primera versión.
  await page.getByLabel('¿Qué querés proponer?').fill('Notificar cuando una orden se atrasa');
  const creado = page.waitForResponse((r) => r.url().endsWith('/documents') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Empezar el caso de negocio' }).click();
  const respuesta = await creado;
  expect(respuesta.status()).toBe(200);
  expect(respuesta.request().postDataJSON()).toEqual({ kind: 'BC', title: 'Notificar cuando una orden se atrasa', fields: { justified_by: ['FB-901'] } });
  const { document: bc } = (await respuesta.json()) as { document: { docId: string; latestVersion: { versionNo: number; renderedMarkdown: string } } };
  expect(bc.latestVersion.versionNo).toBe(1);
  expect(bc.latestVersion.renderedMarkdown).toContain('justified_by: ["FB-901"]');

  // 4) Queda en el documento, con la guía al lado y el origen ya puesto: nada de editar frontmatter.
  await expect(page).toHaveURL(`${planta}/documents/${bc.docId}`);
  const guia = page.getByRole('complementary', { name: 'Guía del caso de negocio' });
  await expect(guia).toBeVisible();
  await expect(guia.getByText('El problema', { exact: true })).toBeVisible();
  await expect(guia.getByText('Cuánto cuesta, a grandes rasgos')).toBeVisible();
  await expect(guia.getByText('0 de 4 escritas')).toBeVisible();
  await expect(page.getByLabel('Justificado por')).toHaveValue('FB-901');

  expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual(violations);
});
