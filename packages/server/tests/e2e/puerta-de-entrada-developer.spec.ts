/**
 * WO-573 (SDD-055/PRD-033 R4): the developer path, in a real browser against the real server and database.
 * From the Planta's entry band to the setup screen, checking the two things that can only be wrong in a real
 * browser: the commands carry *this* server's origin (not a literal anyone could copy wrong), and the state
 * shown matches the credentials the database actually holds.
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

/** Marks the harness's own personal token as used, which is the only evidence the server has that the proxy
 * ever connected from someone's machine. */
async function markCredentialUsed(): Promise<void> {
  await journey.pg.ownerPool.query(`UPDATE "api_tokens" SET last_used_at = now() WHERE kind = 'personal'`);
}

test('el camino de developer: los comandos traen este servidor, y el estado sale de las credenciales reales', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => ((window as unknown as { __csp: string[] }).__csp ??= []).push(e.violatedDirective));
  });

  await login(page);
  const planta = `${journey.baseUrl}/o/${journey.org.slug}/p/${journey.project.slug}`;
  await page.goto(planta);

  // La puerta de la Planta lleva al camino de developer.
  await page.getByRole('button', { name: /Escribo el código/ }).click();
  await page.getByRole('region', { name: 'Tu próximo paso' }).getByRole('link', { name: 'Conectar mi entorno' }).click();
  await expect(page).toHaveURL(`${planta}/construir/developer`);
  await expect(page.getByRole('heading', { level: 1, name: 'Conectar tu entorno a este proyecto' })).toBeVisible();

  // 1) La credencial del harness ya existe y todavía no se usó: falta vincular.
  await expect(page.getByText('Credencial creada, falta vincular')).toBeVisible();
  await expect(page.getByText(/Todavía no vimos ninguna conexión/)).toBeVisible();

  // 2) Los comandos traen el origen real de este servidor y este proyecto, no un literal.
  const comandos = page.getByRole('group', { name: 'Comandos para vincular el repositorio' });
  await expect(comandos).toContainText(`prdm login --server ${journey.baseUrl}`);
  await expect(comandos).toContainText(`prdm link ${journey.org.slug}/${journey.project.slug} --server ${journey.baseUrl} --mcp`);
  await expect(comandos).toContainText('prdm hooks install');

  // 3) Copiar deja en el portapapeles exactamente eso.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await comandos.getByRole('button', { name: 'Copiar' }).click();
  await expect(comandos.getByRole('button', { name: 'Copiado' })).toBeVisible();
  const portapapeles = await page.evaluate(() => navigator.clipboard.readText());
  expect(portapapeles).toContain(`prdm link ${journey.org.slug}/${journey.project.slug} --server ${journey.baseUrl} --mcp`);

  // 4) Los datos del proyecto son los de verdad.
  const datos = page.getByRole('complementary', { name: 'Datos de este proyecto' });
  await expect(datos).toContainText(journey.project.graphProjectId);
  await expect(datos).toContainText(journey.baseUrl);

  // 5) La entrada MCP para otro cliente no lleva ningún secreto.
  await page.getByRole('radio', { name: 'Otro cliente MCP' }).click();
  const entrada = page.getByRole('group', { name: 'Entrada para tu cliente MCP' });
  await expect(entrada).toContainText('"prdm-remote"');
  expect(await entrada.textContent()).not.toContain(journey.mcpTokenSecret);

  // 6) En cuanto esa credencial se usa, la pantalla lo dice sola.
  await markCredentialUsed();
  await page.reload();
  await expect(page.getByText('Conectado')).toBeVisible();
  await expect(page.getByText(/Todavía no vimos ninguna conexión/)).toHaveCount(0);

  expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual(violations);
});
