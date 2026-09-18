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
 * station literals/labels this spec asserts on to match SDD-024's seven-station rename. Separately,
 * SDD-023's `checkFeatureBusinessCase` (merged before SDD-024) now requires a PRD's justification to resolve
 * to an *approved BC*, not just any Feedback -- this spec still justifies its PRD with a plain FB, same as
 * before SDD-023. Whether that still lets the PRD publish (and reach "diseño técnico") needs verifying by
 * actually running this spec; if SDD-023 broke it, fixing it is its own WO (adding a BC-creation-and-
 * approval step to the journey), out of scope here.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD, startJourney, stopJourney, type Journey } from './harness.js';

let journey: Journey;

const ALICE_HANDLE = 'alice-e2e-line-board';

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

async function typeIntoEmptyBody(page: Page, text: string): Promise<void> {
  await switchToMarkdownTab(page);
  await page.locator('.cm-content').click();
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

test('Planta/Entrada/Órdenes real-data flows, with a failing securitypolicyviolation listener (WO-368)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { baseUrl, org, project, alice } = journey;

  const context = await browser.newContext();
  const page = await context.newPage();
  await installCspViolationListener(page);
  await login(page, baseUrl, alice.email);

  let prdDocId = '';

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

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${prdDocId}`);
    await page.getByLabel('Justificado por').fill(fbDocId);
    await page.getByLabel('Justificado por').blur();
    await expect(page.getByText(/has no justification/)).toBeHidden();
    await waitForFieldOnServer(context, `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${prdDocId}`, 'Justificado por', fbDocId);
  });

  await test.step('Planta: publishing the now-justified PRD shows it at the real Diseño técnico station', async () => {
    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`${prdDocId} .*estación Diseño técnico`) })).toBeVisible();
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

    await row.getByRole('button', { name: 'Enlazar a feature' }).click();
    const linkDialog = page.getByRole('dialog', { name: 'Enlazar a feature' });
    await expect(linkDialog.getByText(prdDocId).first()).toBeVisible();
    await linkDialog.getByRole('button', { name: 'Enlazar' }).click();

    await expect(row.getByText('Triado')).toBeVisible();
  });

  let workOrderId = '';

  await test.step('Planta: publishing an architecting SDD (with its generated work order) moves the PRD to Planificación', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createDocument(page, 'SDD', 'Line Board System Design');
    const sddLink = page.getByRole('link', { name: /^SDD-\d+$/ });
    await expect(sddLink).toBeVisible();
    const sddDocId = (await sddLink.textContent())!.trim();
    await sddLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Line Board System Design' })).toBeVisible();
    await fillTitle(page, 'Line Board System Design');

    const impactedPath = 'packages/app/src/e2e/line-board.ts';
    const tasksBody = '## Tareas\n\n- [ ] Wire the real line-board station transitions';
    await page.getByLabel('Arquitecta a').fill(prdDocId);
    await page.getByLabel('Arquitecta a').blur();
    await page.getByLabel('Rutas impactadas').fill(impactedPath);
    await page.getByLabel('Rutas impactadas').blur();
    await typeIntoEmptyBody(page, tasksBody);

    const sddUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${sddDocId}`;
    await waitForFieldOnServer(context, sddUrl, 'Arquitecta a', prdDocId);
    await waitForFieldOnServer(context, sddUrl, 'Rutas impactadas', impactedPath);
    await waitForBodyOnServer(context, sddUrl, 'Wire the real line-board station transitions');

    await switchToValidationTab(page);
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
    await publishFromReview(page);
    await expect(page.locator('p', { hasText: /published/ })).toBeVisible();
    await expect(page.getByText(/Work orders generados: 1/)).toBeVisible();

    const res = await page.request.get(`${baseUrl}/api/app/organizations/${org.slug}/projects/${project.slug}/documents?kind=WO`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { documents: { docId: string; workflowState: string }[] };
    expect(body.documents).toHaveLength(1);
    workOrderId = body.documents[0]!.docId;

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('link', { name: new RegExp(`${prdDocId} .*estación Planificación`) })).toBeVisible();
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

  await test.step('Planta: claiming the work order moves the PRD to the real Construcción station', async () => {
    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}`);
    await expect(page.getByRole('link', { name: new RegExp(`${prdDocId} .*estación Construcción`) })).toBeVisible();
  });

  await test.step('Zero CSP violations fired during the whole journey', async () => {
    const violations = await page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
    expect(violations).toEqual([]);
  });

  await context.close();
});
