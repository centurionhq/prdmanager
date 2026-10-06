/**
 * WO-369 — accessibility gate for SDD-013's ported frontend screens: an axe-core scan of every major
 * screen/state (see `./accessibility-helpers.ts` for the shared harness/scan setup this file and
 * `accessibility-editor.spec.ts` both use).
 */
import { expect, test } from '@playwright/test';
import { startJourney, stopJourney, type Journey } from './harness.js';
import { expectNoViolations, login, switchToMarkdownTab } from './accessibility-helpers.js';

let journey: Journey;

test.beforeAll(async () => {
  journey = await startJourney();
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

test.describe('Accessibility gate: ported frontend screens (WO-369)', () => {
  test('anonymous auth screens are clean', async ({ page }) => {
    const { baseUrl } = journey;

    await page.goto(`${baseUrl}/login`);
    await expectNoViolations(page, '/login');

    await page.goto(`${baseUrl}/reset-password`);
    await expectNoViolations(page, '/reset-password (request step)');

    await page.goto(`${baseUrl}/invite/nonexistent-invitation-id#s=test-secret`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoViolations(page, '/invite/:id (new-user form)');
  });

  test('org- and project-level screens are clean', async ({ page }) => {
    const { baseUrl, org, project, alice } = journey;
    await login(page, baseUrl, alice.email);

    await page.goto(`${baseUrl}/o/${org.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Proyectos' })).toBeVisible();
    await expectNoViolations(page, '/o/:orgSlug (Proyectos)');

    await page.goto(`${baseUrl}/o/${org.slug}/ajustes/miembros`);
    await expectNoViolations(page, 'org ajustes/miembros');

    await page.goto(`${baseUrl}/o/${org.slug}/ajustes/auditoria`);
    await expectNoViolations(page, 'org ajustes/auditoria');

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    await expectNoViolations(page, 'Planta');

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/arbol`);
    await expectNoViolations(page, 'Árbol de features');

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ordenes`);
    await expectNoViolations(page, 'Órdenes');

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/drift`);
    await expectNoViolations(page, 'Drift');

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/entrada`);
    await expectNoViolations(page, 'Entrada');

    // WO-622 (SDD-065 D8): axe no detecta nombres accesibles duplicados — el contrato de nombres lo
    // afirma Entrada.test.tsx. Este scan extra cubre layout/contraste con la barra de lote y el drawer
    // montados, que hoy no se escanean.
    await page.getByRole('button', { name: 'Registrar feedback' }).click();
    const register = page.getByRole('dialog', { name: 'Registrar feedback' });
    await register.getByLabel('Fuente').fill('other');
    const body = 'Feedback de a11y para el lote y el drawer.';
    await register.getByLabel('Texto').fill(body);
    await register.getByRole('button', { name: 'Registrar feedback' }).click();

    const row = page.getByRole('row').filter({ hasText: body }).first();
    await expect(row).toBeVisible();
    await row.getByRole('checkbox', { name: /^Seleccionar FB-/ }).check();
    await expect(page.getByRole('button', { name: 'Descartar seleccionados' })).toBeVisible();
    await expectNoViolations(page, 'Entrada (lote seleccionado)');

    // Abre el drawer: click sobre la celda del Id (no sobre el checkbox ni los botones, que hacen stopPropagation).
    await row.getByRole('cell', { name: /^FB-\d+$/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, 'Entrada (drawer abierto)');

    for (const tab of ['general', 'miembros', 'tokens', 'tokens-personales', 'perfil', 'auditoria']) {
      await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ajustes/${tab}`);
      await expectNoViolations(page, `project ajustes/${tab}`);
    }
  });

  // SDD-083 WO-B (e): el Árbol alcanzado por link con `?q=`. El buscador vive en la URL (D1), así que este
  // es el estado que comparte un link. Ojo con el alcance: el harness de este suite levanta un proyecto
  // SIN features (`harness.ts` limpia el grafo), así que acá la pantalla muestra su vacío de «Todavía no
  // hay features» y no el vacío propio de la búsqueda (D3) ni las reglas que sólo aparecen con filas
  // reales — eso va como FB aparte, no es parte del rework de WO-678. Lo que este caso cubre es que el
  // `?q=` en la URL no rompe el render ni trae violaciones nuevas a 1440 ni a 375 px.
  test('the Árbol screen with ?q= is clean at 1440 and 375 (SDD-083 WO-B)', async ({ page }) => {
    const { baseUrl, org, project, alice } = journey;
    await login(page, baseUrl, alice.email);

    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(viewport);

      await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/arbol?q=arbol`);
      await expect(page.getByRole('heading', { level: 1, name: 'Árbol de features' })).toBeVisible();
      await expectNoViolations(page, `Árbol ?q=arbol @${viewport.width}`);

      await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/arbol?q=sin-coincidencias`);
      await expect(page.getByRole('heading', { level: 1, name: 'Árbol de features' })).toBeVisible();
      await expectNoViolations(page, `Árbol ?q=sin-coincidencias @${viewport.width}`);
    }
  });

  test('the documents list, its "Nuevo documento" modal, and a document detail page are clean', async ({ page }) => {
    const { baseUrl, org, project, alice } = journey;
    await login(page, baseUrl, alice.email);

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await expectNoViolations(page, 'Documentos (list)');

    await page.getByRole('button', { name: 'Nuevo documento' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, 'Documentos: "Nuevo documento" modal (open)');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tipo de documento').selectOption('PRD');
    await dialog.getByLabel('Título').fill('A11y Review PRD');
    await dialog.getByRole('button', { name: 'Crear' }).click();

    const link = page.getByRole('row', { name: 'A11y Review PRD' }).getByRole('link', { name: /^PRD-\d+$/ });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('heading', { name: 'A11y Review PRD' })).toBeVisible();

    // A body with headings/lists/tasks/a link, so the block editor actually renders every construct
    // WO-387's own checklist calls out, not just an empty document.
    await switchToMarkdownTab(page);
    await page.locator('.cm-content').click();
    // A fresh PRD's body isn't empty -- "Nuevo documento" seeds it from the PRD template ("## Resumen/##
    // Requisitos/## Fuera de alcance"), so select-all before typing to replace it outright.
    await page.keyboard.press('Control+a');
    const lines = ['# Overview', '', 'A **bold** point with a [link](https://example.com).', '', '- one', '- two', '', '- [ ] pending task'];
    for (const [index, line] of lines.entries()) {
      if (index > 0) await page.keyboard.press('Enter');
      if (line.length > 0) await page.keyboard.type(line);
    }

    await page.getByRole('tab', { name: 'Vista previa' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
    // The page's own document-title `<h1>` must stay the only level-one heading even once the body has
    // its own top-level heading (WO-387's `PreviewEditor.tsx` fix).
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expectNoViolations(page, 'DocumentDetail (Vista previa tab, with headings/lists/tasks/link)');

    await switchToMarkdownTab(page);
    await expectNoViolations(page, 'DocumentDetail (Markdown tab)');
  });
});
