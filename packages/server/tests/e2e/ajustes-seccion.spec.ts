/**
 * WO-583 (SDD-056/PRD-036 R4): the whole Ajustes section in a real browser, against the real server and
 * database, at desktop and at 375 px.
 *
 * It exists because of what the unit tests could not see. Two production defects hid behind green suites here:
 * every form was unstyled because two stylesheets used variables nobody defines (FB-035), and both audit screens
 * crashed because the client read `items` while the server sends `entries`. Unit tests mocked the client's own
 * assumptions, and the axe scan passed over the crash page (an error page has nothing to violate). So this spec
 * asserts what a person sees: real content on every screen, never the error page, no sideways scroll on a phone,
 * a control that actually has its border, and the flows whose failure is invisible until someone tries them.
 */
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;
let page: Page;

// One sign-in for the whole file: the server rate-limits repeated sign-ins from the same address, and this
// spec is about the section, not about logging in.
test.beforeAll(async ({ browser }) => {
  journey = await startJourney();
  page = await browser.newPage();
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => ((window as unknown as { __csp: string[] }).__csp ??= []).push(e.violatedDirective));
  });
  await page.goto(`${journey.baseUrl}/login`);
  await page.getByLabel('Email').fill(journey.alice.email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/o\//);
});

test.afterAll(async () => {
  await page?.close();
  if (journey) await stopJourney(journey);
});

const project = (): string => `${journey.baseUrl}/o/${journey.org.slug}/p/${journey.project.slug}/ajustes`;
const org = (): string => `${journey.baseUrl}/o/${journey.org.slug}/ajustes`;

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function expectNotTheErrorPage(page: Page): Promise<void> {
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
}

test('cada pantalla de Ajustes muestra contenido real, en escritorio y a 375 px, sin desborde', async () => {
  const violations: string[] = [];

  // Un token de CI existe (lo crea el harness), así que la auditoría del proyecto y de la organización tienen una fila real.
  const screens: Array<{ name: string; url: () => string; heading: string | RegExp; level: 1 | 2; content: string | RegExp }> = [
    { name: 'General', url: () => `${project()}/general`, heading: 'General', level: 2, content: 'Rama por defecto' },
    { name: 'Miembros del proyecto', url: () => `${project()}/miembros`, heading: 'Miembros del proyecto', level: 2, content: 'Qué puede hacer cada rol' },
    { name: 'Tokens de CI', url: () => `${project()}/tokens`, heading: 'Tokens de CI', level: 2, content: 'e2e-ci' },
    { name: 'Tokens personales', url: () => `${project()}/tokens-personales`, heading: 'Tokens personales', level: 2, content: 'Organización' },
    { name: 'Perfil', url: () => `${project()}/perfil`, heading: 'Perfil', level: 2, content: 'Email' },
    { name: 'Auditoría del proyecto', url: () => `${project()}/auditoria`, heading: 'Auditoría', level: 2, content: 'token.ci.created' },
    { name: 'Miembros de la organización', url: () => `${org()}/miembros`, heading: /^Miembros de /, level: 1, content: 'Invitaciones pendientes' },
    { name: 'Auditoría de la organización', url: () => `${org()}/auditoria`, heading: /^Auditoría de /, level: 1, content: 'token.ci.created' },
  ];

  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    for (const screen of screens) {
      await page.goto(screen.url());
      await expect(page.getByRole('heading', { level: screen.level, name: screen.heading }).first(), `${screen.name} @${viewport.width}`).toBeVisible();
      await expect(page.getByText(screen.content).first(), `${screen.name} @${viewport.width}: contenido`).toBeVisible();
      await expectNotTheErrorPage(page);
      expect(await sidewaysOverflow(page), `${screen.name} @${viewport.width}: desborde horizontal`).toBeLessThanOrEqual(0);
    }
  }

  expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual(violations);
});

test('los campos tienen su borde: el estilado no vuelve a resolver a nada', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`${project()}/general`);
  const rama = page.getByLabel('Rama por defecto');
  await expect(rama).toBeVisible();
  expect(await rama.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  expect(await rama.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(40);

  await page.goto(`${project()}/tokens`);
  await page.getByRole('button', { name: 'Crear token' }).click();
  expect(await page.getByLabel('Nombre').evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  const submit = page.getByRole('button', { name: 'Crear token' });
  expect(await submit.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test('crear un token con la fecha como viene funciona, y se revoca', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${project()}/tokens`);

  await page.getByRole('button', { name: 'Crear token' }).click();
  await page.getByLabel('Nombre').fill('e2e-ajustes');
  await page.getByLabel('reports:write').check();
  // No se toca "Vence": el valor propuesto tiene que ser aceptado por el servidor.
  const creado = page.waitForResponse((r) => r.url().endsWith('/ci-tokens') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Crear token' }).click();
  expect((await creado).status()).toBe(200);

  await expect(page.getByText('Token creado')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Token recién creado' })).toContainText('prdm_ci_');

  const fila = page.getByRole('row', { name: /e2e-ajustes/ });
  await expect(fila).toContainText('Activo');
  await fila.getByRole('button', { name: /Revocar/ }).click();
  await expect(page.getByRole('row', { name: /e2e-ajustes/ })).toContainText('Revocado');
  await expect(page.getByRole('row', { name: /e2e-ajustes/ }).getByRole('button', { name: /Revocar/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ya lo guardé' }).click();
  await expect(page.getByText('Token creado')).toHaveCount(0);
});

test('invitar a alguien desde la organización: el diálogo se cierra y la invitación aparece pendiente', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${org()}/miembros`);

  await page.getByRole('button', { name: 'Invitar persona' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Email').fill('nueva.persona@example.test');
  const enviada = page.waitForResponse((r) => r.url().includes('/invitations') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Invitar', exact: true }).click();
  expect((await enviada).status()).toBe(200);

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('row', { name: /nueva\.persona@example\.test/ })).toContainText('pending');
});

test('la subnavegación agrupada lleva a cada destino y marca dónde estás', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${project()}/general`);

  const nav = page.getByRole('navigation', { name: 'Ajustes' });
  await expect(nav.getByRole('link')).toHaveCount(6);
  await expect(nav.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Auditoría' }).click();
  await expect(page).toHaveURL(/\/ajustes\/auditoria$/);
  await expect(nav.getByRole('link', { name: 'Auditoría' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current', 'page');
});
