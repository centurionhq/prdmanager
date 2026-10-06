/**
 * WO-368 (SDD-013 §"Shell y router"): real station transitions on Planta, feedback triage on Entrada, and
 * a work-order claim on Órdenes — all against real backend data (`getLineBoard`/`listInbox`/`listWorkOrders`,
 * never mocked), plus a `securitypolicyviolation` listener that fails the test if any CSP violation fires
 * anywhere during the journey. Reuses `./harness.ts`'s real-server bootstrap, same convention as
 * `full-journey.spec.ts`/`accessibility.spec.ts`/`preview-editor-collab.spec.ts`.
 *
 * The PRD/FB/SDD pipeline below mirrors `full-journey.spec.ts`'s own (PRD -> justifying FB -> publish PRD
 * -> architecting SDD -> generated work order) rather than reusing that spec directly: `full-journey.spec.ts`
 * already claims/completes its own work order via a remote MCP client (a *different* real integration this
 * WO isn't re-testing), and inserting a UI-driven claim into that same pipeline would double-claim the same
 * work order and break its own assertions.
 *
 * `station.ts`'s `deriveStation` decides which station a feature lands on, but `pg-project-engine.ts`'s
 * `scan()` only ever surfaces *published* documents (`workflowState === 'published'`) to begin with — a
 * draft PRD is invisible to Planta/Entrada/Órdenes entirely, not merely stuck at "entrada". Combined with
 * publish itself being blocked by an unjustified feature's own `error`-severity lifecycle violation
 * (`check.ts`'s `checkFeature`) AND a brand-new document's live frontmatter defaulting `status` to
 * `"approved"` (confirmed against the real published markdown — there is no UI field to set it to
 * anything else yet), the *first* station a real justified-and-published PRD is ever actually observed at
 * is "diseño técnico" (`deriveStation`'s rule 4 fires on `status === 'approved'` before rule 5's
 * justification check is even reached) — never "entrada" or "producto". The real, UI-visible transition
 * this spec checks is diseño técnico -> planificación (once the architecting SDD's generated work order
 * exists) -> construcción (once that work order is claimed).
 *
 * WO-446/SDD-024 note (station names only, not run in this WO -- see its own commit message): renamed the
 * station literals/labels this spec asserts on to match SDD-024's seven-station rename.
 *
 * SDD-023's `checkFeatureBusinessCase` (merged before SDD-024) requires a PRD's justification to resolve
 * to an *approved BC*, not just any Feedback -- confirmed broken against a plain-FB justification (this
 * spec's own run reproduced it: publish stayed blocked with "is justified, but not by a BC"). Fixed by
 * inserting a BC between the FB and the PRD: the FB justifies the BC, the BC is published, and the PRD's
 * `justified_by` points at the BC instead of the FB directly.
 *
 * WO-614 (SDD-064 WO-D, gate): the Órdenes part of the journey is extended with the integrated result of
 * that blueprint — the URL as source of truth for the filters, a server-side bounded page next to the
 * real total, archiving from the drawer, and «Asignada a: mí» — plus real-browser screenshots at 1440 and
 * 375 px on that same screen, under the same failing `securitypolicyviolation` listener. So that the
 * padrón is big enough to page through for real, the SDD checklist below carries more than one item: a
 * blueprint's `## Tareas` is exactly what `generate_work_orders` turns into work orders, so this stays
 * the real governance pipeline, never a seeded fixture.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;

const ALICE_HANDLE = 'alice-e2e-line-board';

/** Screenshots for the 1440/375 px checks (WO-614) — the same gitignored dir the WO-623 test writes to. */
const SHOTS_DIR = fileURLToPath(new URL('../../test-results/', import.meta.url));

/**
 * WO-614: how many work orders the journey's SDD generates. `ORDENES_PAGE_SIZE` is 25, so 26 is the
 * smallest checklist that makes «one bounded page next to the real total» a real assertion instead of a
 * tautology (page 1 covers 25 of them, page 2 the leftover). The first item keeps its WO-368 wording
 * because the journey still waits for that exact body on the server before publishing.
 */
const SDD_TASKS = ['Wire the real line-board station transitions', ...Array.from({ length: 25 }, (_, i) => `Tarea E2E ${String(i + 2).padStart(2, '0')}`)];

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

async function typeLines(page: Page, text: string): Promise<void> {
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    if (line.length > 0) await page.keyboard.type(line);
  }
}

async function switchToMarkdownTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Markdown' }).click();
}

/** WO-359/WO-164 (same as `full-journey.spec.ts`'s own helper): "Solicitar revisión"/"Publicar" for a
 * collab-origin document live inside `ValidationPanel`, itself behind the "Validación" tab of
 * `DocumentPanelTabs` (default active tab is "Agente") — `Tabs.tsx` renders every inactive panel with a
 * native `hidden` attribute. Idempotent: clicking an already-selected tab is harmless. */
async function switchToValidationTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Validación' }).click();
}

/** Same as `full-journey.spec.ts`'s own helper: a frontmatter `fill()`/`blur()` only writes the *local*
 * Yjs doc synchronously — the websocket message to the server is asynchronous, and publish itself
 * re-derives justification server-side from what it has actually persisted, not from this page's own
 * local state. Opening a throwaway probe page and waiting for it to see the field is a real event
 * (Hocuspocus only applies, then broadcasts), never a fixed wait. */
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

/** A freshly created document's live `Y.Doc` is NOT empty -- "Nuevo documento" seeds it from that kind's
 * template (`packages/core/src/templates/index.ts`). `Control+a` selects that seeded content before
 * typing, so `text` replaces it outright -- see WO-594's commit message for how this was found. */
async function typeIntoEmptyBody(page: Page, text: string): Promise<void> {
  await switchToMarkdownTab(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await typeLines(page, text);
}

/** Scoped to the "Nuevo documento" dialog: the documents list page also has its own "Buscar por id o
 * título" search input, whose accessible name contains "título" too, so an unscoped `getByLabel('Título')`
 * matches both. */
async function createDocument(page: Page, kind: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Nuevo documento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo de documento').selectOption(kind);
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByRole('button', { name: 'Crear' }).click();
}

/** The live collab document's frontmatter starts genuinely empty (same reasoning as the body — see
 * `full-journey.spec.ts`'s own `typeIntoEmptyBody` comment): "Nuevo documento"'s title only ever seeds the
 * very first `document_versions` snapshot, never the live `Y.Doc` this form actually edits — every field,
 * "Título" included, has to be filled for real once inside the document. */
async function fillTitle(page: Page, title: string): Promise<void> {
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Título').blur();
}

async function publishFromReview(page: Page): Promise<void> {
  await switchToValidationTab(page);
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page.getByRole('button', { name: /^Publicar versión \d+$/ }).click();
}

/** Same technique as `learning/app-dist-static-csp.spec.ts`/`learning/codemirror-csp-nonce.spec.ts`. */
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

/** Reads what {@link installCspViolationListener} has collected on the *current* page so far. */
async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
}

test('Planta/Entrada/Órdenes real-data flows, with a failing securitypolicyviolation listener (WO-368)', async ({ browser }) => {
  // WO-614 raises this journey's own budget: the SDD below now publishes 26 checklist items (one work
  // order each) and the Órdenes steps page through them, on top of the original PRD/BC/FB authoring.
  test.setTimeout(300_000);
  const { baseUrl, org, project, alice } = journey;

  const context = await browser.newContext();
  const page = await context.newPage();
  await installCspViolationListener(page);
  await login(page, baseUrl, alice.email);

  let prdDocId = '';
  let bcDocId = '';

  await test.step('Alice creates the PRD and a Feedback that justifies it', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createDocument(page, 'PRD', 'Line Board Journey');
    const prdLink = page.getByRole('link', { name: /^PRD-\d+$/ });
    await expect(prdLink).toBeVisible();
    prdDocId = (await prdLink.textContent())!.trim();
    await prdLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Line Board Journey' })).toBeVisible();
    await fillTitle(page, 'Line Board Journey');

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createDocument(page, 'FB', 'Customers need the line board');
    const fbLink = page.getByRole('link', { name: /^FB-\d+$/ });
    await expect(fbLink).toBeVisible();
    const fbDocId = (await fbLink.textContent())!.trim();
    await fbLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Customers need the line board' })).toBeVisible();
    await fillTitle(page, 'Customers need the line board');

    await page.getByLabel('Fuente').fill('other');
    await page.getByLabel('Fuente').blur();
    // See `full-journey.spec.ts`'s own comment: `root: true` avoids an `informs` link to a not-yet-published
    // PRD failing a publish-mode link check.
    await page.getByLabel('Raíz (excepción de ciclo de vida)').check();
    await typeIntoEmptyBody(page, 'Several customers asked when the line board ships.');

    const fbUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${fbDocId}`;
    await waitForBodyOnServer(context, fbUrl, 'Several customers asked when the line board ships.');

    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();

    // SDD-023's `checkFeatureBusinessCase` requires a PRD's justification to resolve to an *approved BC*,
    // not just any Feedback -- so the FB above only justifies the BC, and the PRD is justified by the BC
    // itself. "Nuevo documento" only ever seeds the *editor's local display* from the BC template
    // (`packages/core/src/templates/index.ts`) -- the server-side body stays genuinely empty until a real
    // edit syncs it (same root cause `typeIntoEmptyBody`'s own doc comment now explains), so the four
    // sections `checkBusinessCase` requires have to be typed for real, not left as the visual-only
    // template placeholder.
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createDocument(page, 'BC', 'Caso de negocio: Line Board Journey');
    const bcLink = page.getByRole('link', { name: /^BC-\d+$/ });
    await expect(bcLink).toBeVisible();
    bcDocId = (await bcLink.textContent())!.trim();
    await bcLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Caso de negocio: Line Board Journey' })).toBeVisible();
    await fillTitle(page, 'Caso de negocio: Line Board Journey');
    await page.getByLabel('Justificado por').fill(fbDocId);
    await page.getByLabel('Justificado por').blur();
    await waitForFieldOnServer(context, `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${bcDocId}`, 'Justificado por', fbDocId);

    await typeIntoEmptyBody(
      page,
      '## Problema\n\nLos clientes no pueden ver el estado real de la linea.\n\n## Impacto esperado\n\nMenos consultas de soporte sobre el estado.\n\n## Métrica de éxito\n\nConsultas de soporte bajan 30%.\n\n## Costo estimado\n\nUn sprint de un developer.',
    );
    const bcUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${bcDocId}`;
    await waitForBodyOnServer(context, bcUrl, 'Un sprint de un developer.');

    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    // `PublishReviewModal`'s validation summary comes from `doc.lastValidation`, only refreshed by
    // `DocumentDetail`'s own `reload()` -- `openPublishReview` itself doesn't trigger one. A hard reload
    // here forces a fresh fetch instead of risking a `Publicar` click racing whatever `lastValidation`
    // snapshot happened to be in memory (confirmed stale in practice: the dialog once showed "1 error"
    // and a leftover "cannot publish" banner immediately after the body/justified_by above had both
    // already round-tripped through `waitForBodyOnServer`/`waitForFieldOnServer`).
    await page.reload();
    await switchToValidationTab(page);
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${prdDocId}`);
    await page.getByLabel('Justificado por').fill(bcDocId);
    await page.getByLabel('Justificado por').blur();
    await expect(page.getByText(/has no justification/)).toBeHidden();
    await waitForFieldOnServer(context, `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${prdDocId}`, 'Justificado por', bcDocId);
  });

  await test.step('Planta: publishing the now-justified PRD shows it at the real Producto station', async () => {
    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();

    // WO-443 (SDD-024 §4.4): a PRD whose `justified_by` resolves to a present BC no longer gets its own
    // top-level row -- it collapses into `FeatureLine.children` of that BC's row (`LineBoard.tsx`'s
    // `secondaryLine`), so the station shown on the board from here on is the *BC*'s own row (whose
    // `deriveBcRowStation`, `station.ts`, reuses the same architecting-blueprint/work-order graph a
    // legacy top-level PRD's `deriveStation` would -- but unlike that one, it splits "producto" (PRD
    // approved, no architecting blueprint yet) from "diseño técnico" (one exists) into two distinct
    // stations instead of collapsing them: PRD-011 §4.4 is explicit that a just-approved PRD with no SDD
    // yet parks at "Producto", not "Diseño técnico"). The PRD's id still shows, just as plain text inside
    // that row rather than as its own "estación"-labeled link.
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    const bcRow = page.getByRole('link', { name: new RegExp(`${bcDocId} .*estación Producto`) });
    await expect(bcRow).toBeVisible();
    await expect(bcRow).toContainText(prdDocId);
  });

  await test.step('Entrada: submit feedback, then triage it into the PRD feature from the inbox', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/entrada`);
    await expect(page.getByRole('heading', { level: 1, name: 'Bandeja de entrada' })).toBeVisible();

    await page.getByRole('button', { name: 'Registrar feedback' }).click();
    const registerDialog = page.getByRole('dialog', { name: 'Registrar feedback' });
    // The feedback body literally mentions the PRD's own id so `triageText`'s mention-detection surfaces
    // it as the top ("mejor coincidencia") candidate deterministically, rather than relying on a fuzzy
    // score match that could pick a different feature.
    await registerDialog.getByLabel('Fuente').fill('other');
    await registerDialog.getByLabel('Texto').fill(`Please prioritize ${prdDocId}, the line board is blocking our rollout.`);
    await registerDialog.getByRole('button', { name: 'Registrar feedback' }).click();

    const row = page.getByRole('row').filter({ hasText: 'line board is blocking' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Sin triar')).toBeVisible();

    // WO-614: the row control's accessible name carries its item id since WO-622 (`Enlazar FB-002 a
    // una feature`); the old bare `Enlazar a feature` no longer matches anything, which is why this
    // journey was red on `main` before this work order — the WO-623 test below already uses the new name.
    await row.getByRole('button', { name: /^Enlazar FB-\d+ a una feature$/ }).click();
    const linkDialog = page.getByRole('dialog', { name: 'Enlazar a feature' });
    await expect(linkDialog.getByText(prdDocId).first()).toBeVisible();
    await linkDialog.getByRole('button', { name: 'Enlazar' }).click();

    await expect(row.getByText('Triado')).toBeVisible();
  });

  let workOrderId = '';
  let secondWorkOrderId = '';

  await test.step('Planta: publishing an architecting SDD (with its generated work orders) moves the PRD to Planificación', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createDocument(page, 'SDD', 'Line Board System Design');
    const sddLink = page.getByRole('link', { name: /^SDD-\d+$/ });
    await expect(sddLink).toBeVisible();
    const sddDocId = (await sddLink.textContent())!.trim();
    await sddLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Line Board System Design' })).toBeVisible();
    await fillTitle(page, 'Line Board System Design');

    const impactedPath = 'packages/app/src/e2e/line-board.ts';
    // WO-614: a checklist with one item per work order the Órdenes steps need to page through.
    const tasksBody = `## Tareas\n\n${SDD_TASKS.map((task) => `- [ ] ${task}`).join('\n')}`;
    await page.getByLabel('Arquitecta a').fill(prdDocId);
    await page.getByLabel('Arquitecta a').blur();
    await page.getByLabel('Rutas impactadas').fill(impactedPath);
    await page.getByLabel('Rutas impactadas').blur();
    await typeIntoEmptyBody(page, tasksBody);

    const sddUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${sddDocId}`;
    await waitForFieldOnServer(context, sddUrl, 'Arquitecta a', prdDocId);
    await waitForFieldOnServer(context, sddUrl, 'Rutas impactadas', impactedPath);
    // WO-614: the checklist is long enough that waiting only for its first item can still resolve while
    // the tail is in flight — and publishing then generates work orders from a partial checklist. Yjs
    // applies a document's updates in order, so seeing the *last* item on a probe page proves every
    // earlier one is persisted server-side too.
    await waitForBodyOnServer(context, sddUrl, SDD_TASKS[0]!);
    await waitForBodyOnServer(context, sddUrl, SDD_TASKS[SDD_TASKS.length - 1]!);

    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();
    await expect(page.getByText(new RegExp(`Work orders generados: ${SDD_TASKS.length}`))).toBeVisible();

    const res = await page.request.get(`${baseUrl}/api/app/organizations/${org.slug}/projects/${project.slug}/documents?kind=WO`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { documents: { docId: string; title: string; workflowState: string }[] };
    expect(body.documents).toHaveLength(SDD_TASKS.length);
    // `planWorkOrders` walks the checklist in order and hands out ids sequentially, so the two lowest ids
    // are the first two tasks' work orders: the first one is what the UI claims below, the second the
    // pending one the archive step takes out of the queue.
    const woIds = body.documents.map((document) => document.docId).sort((a, b) => a.localeCompare(b));
    workOrderId = woIds[0]!;
    secondWorkOrderId = woIds[1]!;

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    // Same WO-443 collapse as the earlier station check -- the row is keyed on the BC, not the PRD.
    await expect(page.getByRole('link', { name: new RegExp(`${bcDocId} .*estación Planificación`) })).toBeVisible();
  });

  await test.step('Órdenes: claim the work order from the drawer and see it reflect as claimed', async () => {
    // `claimWorkOrder`'s assignee is `dev:<user_profile.handle>` (project-work-orders.ts) — there is no
    // dashboard UI to set one yet (`AjustesPerfil.tsx`'s own doc comment), so this test-only row stands in
    // for whatever onboarding step will eventually create it for a real account.
    await journey.pg.ownerPool.query('INSERT INTO "user_profile" (user_id, handle) VALUES ($1, $2)', [alice.id, ALICE_HANDLE]);

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ordenes`);
    await expect(page.getByRole('heading', { level: 1, name: 'Órdenes de trabajo' })).toBeVisible();

    await page.getByRole('row', { name: new RegExp(workOrderId) }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Sin asignar')).toBeVisible();

    await drawer.getByRole('button', { name: 'Tomar orden' }).click();
    await expect(drawer.getByText('En curso')).toBeVisible();
    await expect(drawer.getByText(`dev:${ALICE_HANDLE}`)).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Tomar orden' })).toHaveCount(0);

    await drawer.getByRole('button', { name: 'Cerrar' }).click();
  });

  await test.step('Órdenes: el servidor devuelve una página acotada junto al total real (WO-614)', async () => {
    const apiBase = `${baseUrl}/api/app/organizations/${org.slug}/projects/${project.slug}`;
    const envelopeRes = await page.request.get(`${apiBase}/graph/work-orders?limit=25&offset=0`);
    expect(envelopeRes.ok()).toBe(true);
    const envelope = (await envelopeRes.json()) as { items: unknown[]; total: number; statusCounts: { all: number } };
    // SDD-064 D2/D8/R2: the screen's own endpoint answers one bounded page plus the real total — never the
    // whole padrón. Neither number is hardcoded: they come from the same response the UI consumes.
    expect(envelope.total).toBe(SDD_TASKS.length);
    expect(envelope.items).toHaveLength(25);
    expect(envelope.statusCounts.all).toBe(SDD_TASKS.length);

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ordenes`);
    await expect(page.getByRole('heading', { level: 1, name: 'Órdenes de trabajo' })).toBeVisible();
    await expect(page.locator('p', { hasText: `Mostrando 25 de ${envelope.total} órdenes` })).toBeVisible();
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    // One header row plus exactly the 25 rows of this page.
    await expect(page.getByRole('row')).toHaveCount(26);

    await page.getByRole('button', { name: 'Página siguiente' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('p', { hasText: `Mostrando ${envelope.total} de ${envelope.total} órdenes` })).toBeVisible();
    // The page is bounded, not the padrón: the second page carries only the leftover row.
    await expect(page.getByRole('row')).toHaveCount(2);

    await page.getByRole('button', { name: 'Página anterior' }).click();
    await expect(page).not.toHaveURL(/page=2/);
  });

  await test.step('Órdenes: un filtro vive en la URL y un reload reproduce la vista (WO-614)', async () => {
    await page.getByRole('radio', { name: /En curso/ }).click();
    await expect(page).toHaveURL(/status=in_progress/);
    // The order claimed above is the only in-progress one.
    await expect(page.locator('p', { hasText: 'Mostrando 1 de 1 órdenes' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(workOrderId) })).toBeVisible();

    // Reload, never re-click: the URL alone has to reproduce the filtered view (SDD-064 D6).
    await page.reload();
    await expect(page.getByRole('radio', { name: /En curso/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('p', { hasText: 'Mostrando 1 de 1 órdenes' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(workOrderId) })).toBeVisible();

    await page.getByRole('radio', { name: /Todas/ }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.locator('p', { hasText: `Mostrando 25 de ${SDD_TASKS.length} órdenes` })).toBeVisible();
  });

  await test.step('Órdenes: «Asignada a: mí» filtra la propia cola con el handle de la sesión (WO-614)', async () => {
    await page.getByRole('combobox', { name: 'Asignada a' }).selectOption('mio');
    await expect(page).toHaveURL(/actor=mio/);
    await expect(page.locator('p', { hasText: 'Mostrando 1 de 1 órdenes' })).toBeVisible();
    const mine = page.getByRole('row', { name: new RegExp(workOrderId) });
    await expect(mine).toBeVisible();
    // Filtered by the real `dev:<handle>` of the session (SDD-064 D4), not by account class.
    await expect(mine).toContainText(`dev:${ALICE_HANDLE}`);

    await page.getByRole('combobox', { name: 'Asignada a' }).selectOption('todos');
    await expect(page).not.toHaveURL(/actor=mio/);
  });

  await test.step('Órdenes: archivar una orden elegible la saca de la cola y su estado queda visible (WO-614)', async () => {
    await expect(page.locator('p', { hasText: `Mostrando 25 de ${SDD_TASKS.length} órdenes` })).toBeVisible();

    await page.getByRole('row', { name: new RegExp(secondWorkOrderId) }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: 'Archivar' }).click();

    const modal = page.getByRole('dialog', { name: 'Archivar orden' });
    await modal.getByLabel('Motivo (opcional)').fill('Quedó obsoleta: la cubre otra orden');
    await modal.getByRole('button', { name: 'Archivar' }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByText('Orden archivada')).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar' }).click();
    // Archived orders leave the default «Todas» view (SDD-064 D3)...
    const restantes = SDD_TASKS.length - 1;
    await expect(page.locator('p', { hasText: `Mostrando ${restantes} de ${restantes} órdenes` })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(secondWorkOrderId) })).toHaveCount(0);

    // ...and stay reachable through their own chip, with the muted «Archivada» badge.
    await page.getByRole('radio', { name: /Archivadas/ }).click();
    await expect(page).toHaveURL(/status=archived/);
    const archived = page.getByRole('row', { name: new RegExp(secondWorkOrderId) });
    await expect(archived).toBeVisible();
    await expect(archived.getByText('Archivada', { exact: true })).toBeVisible();
  });

  await test.step('Planta: claiming the work order moves the PRD to the real Construcción station', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    // Same WO-443 collapse as the earlier station checks -- the row is keyed on the BC, not the PRD.
    await expect(page.getByRole('link', { name: new RegExp(`${bcDocId} .*estación Construcción`) })).toBeVisible();
  });

  await test.step('Órdenes a 1440 px: captura y cero violaciones de CSP (WO-614)', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ordenes`);
    await expect(page.getByRole('heading', { level: 1, name: 'Órdenes de trabajo' })).toBeVisible();
    await expect(page.getByRole('row').first()).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOTS_DIR}ordenes-1440.png`, fullPage: true });
  });

  await test.step('Órdenes a 375 px: captura y cero violaciones de CSP (WO-614)', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/ordenes`);
    await expect(page.getByRole('heading', { level: 1, name: 'Órdenes de trabajo' })).toBeVisible();
    // The filters are still reachable at 375 px, and the table still shows real rows (stacked layout).
    await expect(page.getByRole('radio', { name: /Todas/ })).toBeVisible();
    await expect(page.getByRole('row').first()).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOTS_DIR}ordenes-375.png`, fullPage: true });
  });

  await test.step('Zero CSP violations fired during the whole journey', async () => {
    const violations = await page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
    expect(violations).toEqual([]);
  });

  await context.close();
});

/**
 * WO-623 (SDD-065 WO-E, gate): the Entrada inbox driven end-to-end against the real backend — register
 * → see it with its `created_at` date → search by text and by source → open the drawer with the rendered
 * body → dismiss with a reason → it leaves «Sin triar» and keeps `status: dismissed` in the graph → a
 * 2-item batch in a single action → the counts and pagination reflect it — plus a real browser at 1440px
 * and 375px with the same failing `securitypolicyviolation` listener the WO-368 journey above installs.
 * Unlike that journey, nothing here depends on the PRD/SDD/work-order pipeline: the SDD-065 triage
 * surface is exercised on its own. The window/pagination numbers are asserted relatively, so a shared
 * project with other tests' items can never make this pass by accident.
 */
test('Entrada: la bandeja operable de punta a punta contra el backend real (WO-623)', async ({ browser }) => {
  test.setTimeout(180_000);
  const { baseUrl, org, project, alice } = journey;
  const SOURCE = 'gate-e2e';
  const ALFA = 'Pedido E2E-ALFA el importador se cuelga';
  const BETA = 'Pedido E2E-BETA exportar a CSV';
  const GAMMA = 'Pedido E2E-GAMMA modo oscuro';
  const DELTA = 'Pedido E2E-DELTA duplicado del importador';
  const entradaUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/entrada`;
  const hoy = new Date();
  const fecha = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
  const shotsDir = fileURLToPath(new URL('../../test-results/', import.meta.url));

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await installCspViolationListener(page);
  await login(page, baseUrl, alice.email);

  const rowOf = (text: string) => page.getByRole('row').filter({ hasText: text });

  async function registrar(texto: string): Promise<void> {
    await page.getByRole('button', { name: 'Registrar feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrar feedback' });
    await dialog.getByLabel('Fuente').fill(SOURCE);
    await dialog.getByLabel('Texto').fill(texto);
    await dialog.getByRole('button', { name: 'Registrar feedback' }).click();
    await expect(dialog).toBeHidden();
  }

  async function conteoChip(label: string): Promise<number> {
    const text = await page.getByRole('radio', { name: new RegExp(label) }).textContent();
    return Number(/(\d+)\s*$/.exec(text ?? '')?.[1] ?? 0);
  }

  async function idDe(boton: Locator): Promise<string> {
    const label = await boton.getAttribute('aria-label');
    const match = /FB-\d+/.exec(label ?? '');
    if (match === null) throw new Error(`sin id de ítem en "${label}"`);
    return match[0];
  }

  async function expectNoCspViolations(): Promise<void> {
    const violations = await page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
    expect(violations).toEqual([]);
  }

  await page.goto(entradaUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Bandeja de entrada' })).toBeVisible();

  await test.step('registrar cuatro FB y verlos en la bandeja con su fecha', async () => {
    for (const texto of [ALFA, BETA, GAMMA, DELTA]) await registrar(texto);
    for (const texto of [ALFA, BETA, GAMMA, DELTA]) {
      const fila = rowOf(texto);
      await expect(fila).toBeVisible();
      // The «Recibido» column renders the item's created_at as DD/MM/YYYY, straight off the ISO string.
      await expect(fila.locator('time')).toHaveText(fecha);
    }
  });

  // The chips/filters are only rendered once the inbox has at least one item (Entrada's own empty state),
  // so the «Sin triar» baseline has to be read after the four items above exist.
  const newAlEmpezar = await conteoChip('Sin triar');

  await test.step('buscar por texto y por fuente', async () => {
    const search = page.getByLabel('Buscar en la bandeja');
    await search.fill('E2E-ALFA');
    await expect(rowOf(ALFA)).toBeVisible();
    await expect(rowOf(BETA)).toBeHidden();
    await expect(page).toHaveURL(/q=E2E-ALFA/);

    await search.fill('');
    // The screen derives every control from the URL and react-router applies `setSearchParams`
    // asynchronously: selecting Fuente before the cleared `q` has re-rendered would spread the stale
    // query and keep filtering by text. Wait for the *list* to come back (only the new render does that),
    // not just for the URL to drop `q`.
    await expect(rowOf(BETA)).toBeVisible();
    await page.getByRole('combobox', { name: 'Fuente' }).selectOption(SOURCE);
    await expect(rowOf(ALFA)).toBeVisible();
    await expect(rowOf(BETA)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`fuente=${SOURCE}`));
  });

  await test.step('abrir el drawer y ver el cuerpo renderizado', async () => {
    await rowOf(ALFA).click();
    const drawer = page.getByRole('dialog', { name: ALFA });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: ALFA })).toBeVisible();
    // The body is markdown-rendered (`## Feedback` + the item's own text); the drawer's own h2 is the
    // item title, so the paragraph is what proves the body actually rendered.
    await expect(drawer.getByRole('paragraph').filter({ hasText: 'el importador se cuelga' })).toBeVisible();
    await expect(drawer.getByText(`Recibido: ${fecha}`)).toBeVisible();
    await drawer.getByRole('button', { name: 'Cerrar' }).click();
    await expect(drawer).toBeHidden();
  });

  await test.step('el contrato de nombres accesibles (WO-622) se cumple en el navegador', async () => {
    // Every row control carries its item id (FB-094) — the very accessible names this spec selects by.
    await expect(rowOf(ALFA).getByRole('button', { name: /^Enlazar FB-\d+ a una feature$/ })).toBeVisible();
    await expect(rowOf(ALFA).getByRole('button', { name: /^Marcar duplicado FB-\d+$/ })).toBeVisible();
    await expect(rowOf(ALFA).getByRole('checkbox', { name: /^Seleccionar FB-\d+$/ })).toBeVisible();
    // No generic, id-less row control survives.
    await expect(page.getByRole('button', { name: /^Descartar$/ })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Recibido' })).toHaveAttribute('aria-sort', 'descending');
    const tipo = page.getByRole('combobox', { name: 'Tipo' });
    await expect(tipo).toHaveAttribute('id', 'entrada-tipo');
    await expect(tipo).toHaveAttribute('name', 'tipo');
  });

  let idAlfa = '';
  await test.step('descartar con motivo: sale de «Sin triar» y queda «Descartado»', async () => {
    const boton = rowOf(ALFA).getByRole('button', { name: /^Descartar FB-\d+$/ });
    idAlfa = await idDe(boton);
    await boton.click();
    const modal = page.getByRole('dialog', { name: 'Descartar ítem' });
    await modal.getByLabel('Motivo (opcional)').fill('ruido de importador, lo cubre otra feature');
    await modal.getByRole('button', { name: /^Descartar$/ }).click();
    await expect(modal).toBeHidden();
    await expect(rowOf(ALFA).getByText('Descartado')).toBeVisible();
  });

  let idBeta = '';
  let idGamma = '';
  await test.step('lote de 2 ítems en una sola acción', async () => {
    idBeta = await idDe(rowOf(BETA).getByRole('button', { name: /^Descartar FB-\d+$/ }));
    idGamma = await idDe(rowOf(GAMMA).getByRole('button', { name: /^Descartar FB-\d+$/ }));

    await rowOf(BETA).getByRole('checkbox', { name: /^Seleccionar FB-\d+$/ }).click();
    await rowOf(GAMMA).getByRole('checkbox', { name: /^Seleccionar FB-\d+$/ }).click();
    await expect(page.getByText('2 seleccionados')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '2 ítems seleccionados' })).toBeVisible();

    await page.getByRole('button', { name: 'Descartar seleccionados' }).click();
    const modal = page.getByRole('dialog', { name: 'Descartar ítem' });
    await modal.getByRole('button', { name: /^Descartar$/ }).click();
    await expect(modal).toBeHidden();

    await expect(rowOf(BETA).getByText('Descartado')).toBeVisible();
    await expect(rowOf(GAMMA).getByText('Descartado')).toBeVisible();
    await expect(page.getByText('2 seleccionados')).toBeHidden();
  });

  let idDelta = '';
  await test.step('marcar un duplicado conserva el documento', async () => {
    const boton = rowOf(DELTA).getByRole('button', { name: /^Marcar duplicado FB-\d+$/ });
    idDelta = await idDe(boton);
    await boton.click();
    const modal = page.getByRole('dialog', { name: 'Marcar duplicado' });
    await modal.getByLabel('Id del duplicado').fill(idAlfa);
    await modal.getByRole('button', { name: /^Marcar duplicado$/ }).click();
    await expect(modal).toBeHidden();
    await expect(rowOf(DELTA).getByText('Duplicado', { exact: true })).toBeVisible();
  });

  await test.step('el total y el paginado reflejan el cambio', async () => {
    // ALFA + BETA + GAMMA left «Sin triar» (dismissed) and DELTA too (duplicate): four fewer.
    const restantes = newAlEmpezar - 4;
    expect(await conteoChip('Sin triar')).toBe(restantes);
    expect(await conteoChip('Descartados')).toBe(3);

    await page.getByRole('radio', { name: /Sin triar/ }).click();
    await expect(rowOf(ALFA)).toBeHidden();
    await expect(rowOf(BETA)).toBeHidden();
    if (restantes > 0) {
      await expect(page.getByText(`1–${restantes} de ${restantes}`)).toBeVisible();
    } else {
      await expect(page.getByText('Ningún ítem coincide con estos filtros')).toBeVisible();
    }

    await page.getByRole('radio', { name: /Descartados/ }).click();
    await expect(rowOf(ALFA).getByText('Descartado')).toBeVisible();
    await expect(rowOf(BETA).getByText('Descartado')).toBeVisible();
    await expect(rowOf(GAMMA).getByText('Descartado')).toBeVisible();
  });

  await test.step('el grafo conserva los documentos descartados/duplicados con su status', async () => {
    const apiBase = `${baseUrl}/api/app/organizations/${org.slug}/projects/${project.slug}`;
    const dismissedRes = await page.request.get(`${apiBase}/inbox?status=dismissed&kind=FB&limit=200`);
    expect(dismissedRes.ok()).toBe(true);
    const dismissed = (await dismissedRes.json()) as { items: { id: string; status: string }[] };
    for (const id of [idAlfa, idBeta, idGamma]) {
      expect(dismissed.items.find((item) => item.id === id)?.status, `${id} sigue en el grafo como dismissed`).toBe('dismissed');
    }

    const duplicateRes = await page.request.get(`${apiBase}/inbox?status=duplicate&kind=FB&limit=200`);
    const duplicate = (await duplicateRes.json()) as { items: { id: string; status: string; duplicateOf: string | null }[] };
    expect(duplicate.items.find((item) => item.id === idDelta)).toMatchObject({ status: 'duplicate', duplicateOf: idAlfa });
  });

  await test.step('1440 px: captura y cero violaciones de CSP', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(entradaUrl);
    await expect(page.getByRole('heading', { level: 1, name: 'Bandeja de entrada' })).toBeVisible();
    await expectNoCspViolations();
    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: `${shotsDir}entrada-1440.png`, fullPage: true });
  });

  await test.step('375 px: el lote y el drawer no rompen el layout, sin violaciones de CSP', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(entradaUrl);
    await expect(page.getByRole('heading', { level: 1, name: 'Bandeja de entrada' })).toBeVisible();
    await expectNoCspViolations();

    await rowOf(ALFA).getByRole('checkbox', { name: /^Seleccionar FB-\d+$/ }).click();
    await expect(page.getByText('1 seleccionados')).toBeVisible();

    await rowOf(ALFA).click();
    const drawer = page.getByRole('dialog', { name: ALFA });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Cerrar' })).toBeVisible();
    await expect(drawer.getByText(`Recibido: ${fecha}`)).toBeVisible();

    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: `${shotsDir}entrada-375-drawer.png`, fullPage: false });

    await expectNoCspViolations();
    await drawer.getByRole('button', { name: 'Cerrar' }).click();
    await expect(drawer).toBeHidden();
  });

  await expectNoCspViolations();
  await context.close();
});
