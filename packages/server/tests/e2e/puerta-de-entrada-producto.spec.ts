/**
 * WO-555 (SDD-052/PRD-033 R3): the product path, in a real browser against the real server and database.
 * From the Planta's entry band to a PRD that already hangs from its initiative:
 *
 *  1. With no approved initiative the screen says so before anything is written, and offers the way out.
 *  2. Once an initiative is approved it is offered, the PRD is created chained to it, and the editor opens on
 *     a document that already has `justified_by` -- the live collab document was seeded from the first version,
 *     not from a patch applied afterwards.
 *
 * The approved BC is seeded straight into the database, the same way `documents-publish.test.ts` seeds one:
 * writing a BC through the UI (the business path) is SDD-B's own journey, and this one is about what comes after.
 * Reuses `./harness.ts`'s real-server bootstrap, same convention as `full-journey.spec.ts`.
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

async function seedApprovedBusinessCase(): Promise<void> {
  const { ownerPool } = journey.pg;
  const { rows: existing } = await ownerPool.query(`SELECT 1 FROM "documents" WHERE project_id = $1 AND doc_id = 'BC-901'`, [journey.project.id]);
  if (existing.length > 0) return;

  await ownerPool.query(
    `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
     VALUES ($1, $2, 'FB-901', 'FB', 'Se frena el arranque', 'docs/fb/FB-901.md', 'collab', 'published', $3)`,
    [journey.org.id, journey.project.id, '---\nid: FB-901\ntype: FB\ntitle: "Se frena el arranque"\nstatus: new\nroot: true\n---\n\nNadie sabe dónde empezar.\n'],
  );
  const bc =
    '---\nid: BC-901\ntype: BC\ntitle: "Que arrancar no frene el trabajo"\nstatus: approved\njustified_by: ["FB-901"]\ntags: []\n---\n\n## Problema\n\nSe frena el arranque.\n\n## Impacto esperado\n\nMás gente arranca.\n\n## Métrica de éxito\n\nArranque sin ayuda.\n\n## Costo estimado\n\nUna iteración.\n';
  await ownerPool.query(
    `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
     VALUES ($1, $2, 'BC-901', 'BC', 'Que arrancar no frene el trabajo', 'docs/bc/BC-901.md', 'collab', 'published', $3)`,
    [journey.org.id, journey.project.id, bc],
  );
}

test('el camino de producto: avisa si no hay iniciativa, y después crea el PRD ya colgado de ella', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => ((window as unknown as { __csp: string[] }).__csp ??= []).push(e.violatedDirective));
  });

  await login(page);
  const planta = `${journey.baseUrl}/o/${journey.org.slug}/p/${journey.project.slug}`;
  await page.goto(planta);

  // La puerta de la Planta lleva al camino de producto.
  await page.getByRole('button', { name: /Defino qué se construye/ }).click();
  await page.getByRole('region', { name: 'Tu próximo paso' }).getByRole('link', { name: 'Escribir los requisitos' }).click();
  await expect(page).toHaveURL(`${planta}/construir/producto`);
  await expect(page.getByRole('heading', { level: 1, name: '¿De qué iniciativa salen estos requisitos?' })).toBeVisible();

  // 1) Sin iniciativa aprobada: lo dice antes de escribir, y no ofrece crear un PRD huérfano.
  await expect(page.getByRole('heading', { name: 'Todavía no hay ninguna iniciativa aprobada' })).toBeVisible();
  await expect(page.getByLabel('¿Qué querés definir?')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Escribir el caso de negocio' })).toHaveAttribute('href', `/o/${journey.org.slug}/p/${journey.project.slug}/construir/negocio`);

  // 2) Con una iniciativa aprobada aparece y viene elegida.
  await seedApprovedBusinessCase();
  await page.reload();
  const grupo = page.getByRole('radiogroup', { name: 'Elegí la iniciativa' });
  await expect(grupo.getByRole('radio')).toHaveCount(1);
  const plaza = grupo.getByRole('radio', { name: /Que arrancar no frene el trabajo/ });
  await expect(plaza).toHaveAttribute('aria-checked', 'true');
  await expect(plaza).toContainText('BC-901');
  await expect(plaza).toContainText('Todavía sin documentos de requisitos');
  await expect(page.getByText(/ya colgado de/)).toContainText('BC-901');

  // Sin título no se crea nada, y lo dice.
  await page.getByRole('button', { name: 'Escribir los requisitos' }).click();
  await expect(page.getByRole('alert')).toContainText('título');

  // 3) Crea el PRD: el POST real lleva justified_by y el servidor lo siembra en la primera versión.
  await page.getByLabel('¿Qué querés definir?').fill('Aviso de orden atrasada en el panel del equipo');
  const creado = page.waitForResponse((r) => r.url().endsWith('/documents') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Escribir los requisitos' }).click();
  const respuesta = await creado;
  expect(respuesta.status()).toBe(200);
  expect(respuesta.request().postDataJSON()).toEqual({ kind: 'PRD', title: 'Aviso de orden atrasada en el panel del equipo', fields: { justified_by: ['BC-901'] } });
  const { document: prd } = (await respuesta.json()) as { document: { docId: string; latestVersion: { versionNo: number; renderedMarkdown: string } } };
  expect(prd.latestVersion.versionNo).toBe(1);
  expect(prd.latestVersion.renderedMarkdown).toContain('justified_by: ["BC-901"]');

  // Queda en el documento, y el editor lo abre YA colgado de la iniciativa: sin editar frontmatter.
  await expect(page).toHaveURL(`${planta}/documents/${prd.docId}`);
  await expect(page.getByLabel('Justificado por')).toHaveValue('BC-901');

  expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual(violations);
});
