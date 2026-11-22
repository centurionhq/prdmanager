/**
 * WO-810 (SDD-125 D4/D5): an approved FR with no design must *stop the line* at `diseno_tecnico`, in the
 * real app, at desktop width and at 375 px. The design hole is a `feature_without_blueprint` **warning** in
 * the drift report (never a publish blocker), so this spec is the proof that the warning still lights the
 * andon: it seeds a real project (an approved BC with an approved PRD and FR, no blueprint architecting
 * either of them), acknowledges the first-scan baseline, and then drives the real SPA through a real
 * browser — no mocked DTO, no jsdom (which cannot see the 375 px layout rule at all).
 *
 * The documents are seeded with the same direct insert the `line-board.test.ts` integration test uses: the
 * publish path needs a live collab doc + the draft → in_review → published round-trip, none of which adds
 * anything to what this WO asserts (the design hole is a property of the *published* set, not of how it got
 * published). `design/centurion-factory/canvas/PlantaBanda.dc.html` and `PlantaMobile.dc.html` already carry
 * the andon treatment this spec verifies (the yellow band cell + the spelled-out stop), so the comp did not
 * need changing for this WO.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { mutationHeaders } from '../helpers/csrf.js';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;

/** Playwright's conventional, gitignored artifacts dir (`packages/server/test-results/`). */
const SHOTS = fileURLToPath(new URL('../../test-results/', import.meta.url));

const FEEDBACK = '---\nid: FB-001\ntype: FB\ntitle: "Feedback"\nstatus: triaged\ninforms: ["BC-001"]\n---\n\nFeedback body.\n';
const BUSINESS_CASE =
  '---\nid: BC-001\ntype: BC\ntitle: "Negocio"\nstatus: approved\njustified_by: []\n---\n\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n';
const PRODUCT = '---\nid: PRD-001\ntype: PRD\ntitle: "Producto"\nstatus: approved\njustified_by: ["BC-001"]\n---\n\n## Problema\n\n## Alcance\n\n## Personas y trabajos\n\n## Métrica de éxito\n\n## Features derivadas\n';
const FEATURE_REQUEST = '---\nid: FR-001\ntype: FR\ntitle: "Pedido"\nstatus: approved\njustified_by: ["BC-001", "PRD-001"]\n---\n\n## Alcance\n\n## Criterio de aceptación\n\n- [ ] hecho\n';

async function seedDocument(docId: string, kind: string, title: string, sourcePath: string, content: string): Promise<void> {
  await journey.pg.ownerPool.query(
    `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
     VALUES ($1, $2, $3, $4, $5, $6, 'generated', 'published', $7)`,
    [journey.org.id, journey.project.id, docId, kind, title, sourcePath, content],
  );
}

async function login(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/o\//);
}

test.beforeAll(async () => {
  journey = await startJourney();
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

test('el FR aprobado sin diseño detiene la línea en Diseño técnico a 1440 y a 375 px (WO-810)', async ({ browser }) => {
  test.setTimeout(180_000);
  const { app, baseUrl, org, project, alice } = journey;

  await seedDocument('FB-001', 'FB', 'Feedback', 'docs/feedback/FB-001.md', FEEDBACK);
  await seedDocument('BC-001', 'BC', 'Negocio', 'docs/business-case/BC-001.md', BUSINESS_CASE);
  await seedDocument('PRD-001', 'PRD', 'Producto', 'docs/prd/PRD-001.md', PRODUCT);
  await seedDocument('FR-001', 'FR', 'Pedido', 'docs/fr/FR-001.md', FEATURE_REQUEST);

  // A brand-new document has no baseline yet, so the first `inspect()` reports it as `feature_changed`
  // (severity error, station `producto`) — that would out-shout the design hole this spec is about.
  // Acknowledging establishes the baseline, exactly like `line-board.test.ts` does.
  const host = { host: new URL(baseUrl).host };
  const signIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email: alice.email, password: PASSWORD }, headers: host });
  const cookie = (Array.isArray(signIn.headers['set-cookie']) ? signIn.headers['set-cookie'][0] : signIn.headers['set-cookie'])!.split(';')[0]!;
  const ack = await app.inject({
    method: 'POST',
    url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/acknowledge`,
    headers: await mutationHeaders(app, host, baseUrl, cookie),
    payload: { target: 'all' },
  });
  await expect(ack.statusCode).toBe(200);

  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, baseUrl, alice.email);

  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);

      // The line's own notice: it names every stopped initiative and the station it is stuck at instead of
      // only tinting a cell — `LineBoard`'s `stopped` list (WO-680). A BC-linked PRD/FR gets no row of its
      // own (WO-443's row collapsing), so this notice is the only surface a nested child has; the summary is
      // what a person sees closed, and the list (hidden while the `<details>` is closed) is one click away.
      await expect(page.getByRole('heading', { name: 'La línea' })).toBeVisible();
      const summary = page.getByText('2 iniciativas detenidas');
      await expect(summary).toBeVisible();
      await summary.click();

      const notice = page.getByRole('list', { name: 'Iniciativas detenidas' });
      await expect(notice).toBeVisible();
      await expect(notice.getByRole('link', { name: /FR-001 Pedido, línea detenida en Diseño técnico/ })).toBeVisible();
      // The approved PRD with no design is the same hole one level up: both stop at `diseno_tecnico`.
      await expect(notice.getByRole('link', { name: /PRD-001 Producto, línea detenida en Diseño técnico/ })).toBeVisible();
      await expect(notice.getByText('detenida en Diseño técnico').first()).toBeVisible();

      await page.screenshot({ path: `${SHOTS}linea-andon-diseno-${viewport.width}.png`, fullPage: true });
    }
  } finally {
    await context.close();
  }
});
