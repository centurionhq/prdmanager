/**
 * WO-385 (SDD-014 §"Editor de vista previa"): a lossless edit made directly in the "Vista previa" tab
 * (`PreviewEditor.tsx`, wired in as the default tab since WO-383) leaves every other byte of the document
 * untouched, propagates to a second collaborating user over the real Hocuspocus/Yjs sync
 * (`full-journey.spec.ts`'s own "Alice and Bob co-edit the body" step exercises the same sync for the
 * Markdown/CodeMirror tab — this is the same live `Y.Text('body')`, edited from the other tab instead), the
 * per-block blame margin (`BlameMargin.tsx`, WO-381) attributes the edit to the editing user once the
 * server's real `blame:stale` broadcast lands (`CollabEditor.tsx`'s `refetchBlame`, no reload, no fixed
 * wait), and the whole flow fires zero `securitypolicyviolation` events.
 *
 * Alice authors the whole original body; Bob is the one who makes the Vista-previa edit — different authors
 * for the edited vs. untouched paragraph is what makes the blame assertion below actually meaningful
 * (`block-blame.ts`'s "most recently received wins": the edited line's attribution flips to whoever typed
 * last, the untouched line's stays with whoever typed it first), rather than every block trivially blaming
 * the same single user regardless of what this WO's fix does.
 *
 * Reuses `./harness.ts`'s real-server bootstrap (real Postgres/Neo4j, the real built `@prdm/app` bundle) —
 * same convention as `full-journey.spec.ts`/`accessibility.spec.ts`, never a second parallel setup.
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

async function switchToPreviewTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Vista previa' }).click();
}

/** A freshly created PRD's live `Y.Doc` is NOT empty -- "Nuevo documento" seeds it from the PRD template
 * (`packages/core/src/templates/index.ts`: "## Resumen/## Requisitos/## Fuera de alcance" already in the
 * body). `Control+a` selects that seeded content before typing, so `text` replaces it outright -- see
 * WO-594's commit message for how the stale "starts genuinely empty" assumption here was found. */
async function typeIntoEmptyBody(page: Page, text: string): Promise<void> {
  await switchToMarkdownTab(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await typeLines(page, text);
}

/** Reconstructs the exact Markdown source from the Markdown (CodeMirror) tab's own rendered lines — every
 * `.cm-line` joined by `\n`, the same shape `text.split('\n')` used to type it in the first place. Small
 * enough a body (a handful of short lines) that CodeMirror never virtualizes it away. */
async function readMarkdownSource(page: Page): Promise<string> {
  await switchToMarkdownTab(page);
  const lines = await page.locator('.cm-line').allTextContents();
  return lines.join('\n');
}

/** Same technique as `learning/app-dist-static-csp.spec.ts`/`learning/codemirror-csp-nonce.spec.ts`: a
 * `securitypolicyviolation` DOM listener installed *before* any navigation (catches a violation even when
 * the browser never also logs a matching console message for it), plus a console-message fallback. */
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

async function readCspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations);
}

const ORIGINAL_SECOND_LINE = 'Segundo parrafo original que tampoco debe cambiar.';
const ORIGINAL_FIRST_PARAGRAPH = 'Primer parrafo original que no debe cambiar en absoluto.';
const EDIT_SUFFIX = ' EDITADO POR ALICE';

function buildBody(firstParagraph: string): string {
  return ['# Titulo del documento', '', firstParagraph, '', ORIGINAL_SECOND_LINE].join('\n');
}

test('a Vista previa edit stays lossless, syncs live, is blamed correctly, and fires zero CSP violations', async ({ browser }) => {
  test.setTimeout(120_000);
  const { baseUrl, org, project, alice, bob } = journey;

  const contextAlice = await browser.newContext();
  const contextBob = await browser.newContext();
  const pageAlice = await contextAlice.newPage();
  const pageBob = await contextBob.newPage();

  await installCspViolationListener(pageAlice);
  await installCspViolationListener(pageBob);

  await login(pageAlice, baseUrl, alice.email);
  await login(pageBob, baseUrl, bob.email);

  let docId = '';

  await test.step('Alice creates a PRD with a multi-paragraph body', async () => {
    await pageAlice.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await pageAlice.getByRole('button', { name: 'Nuevo documento' }).click();
    // Scoped to the "Nuevo documento" dialog: the documents list page also has its own "Buscar por id o
    // título" search input, whose accessible name contains "título" too, so an unscoped `getByLabel('Título')`
    // matches both.
    const newDocumentDialog = pageAlice.getByRole('dialog');
    await newDocumentDialog.getByLabel('Tipo de documento').selectOption('PRD');
    await newDocumentDialog.getByLabel('Título').fill('Preview Editor Journey');
    await newDocumentDialog.getByRole('button', { name: 'Crear' }).click();

    const link = pageAlice.getByRole('link', { name: /^PRD-\d+$/ });
    await expect(link).toBeVisible();
    docId = (await link.textContent())!.trim();
    await link.click();
    await expect(pageAlice.getByRole('heading', { name: 'Preview Editor Journey' })).toBeVisible();

    await typeIntoEmptyBody(pageAlice, buildBody(ORIGINAL_FIRST_PARAGRAPH));
    await expect(pageAlice.locator('.cm-content')).toContainText(ORIGINAL_SECOND_LINE);
  });

  await test.step('Bob opens the same document and sees the original body via Vista previa', async () => {
    await pageBob.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${docId}`);
    await expect(pageBob.getByRole('heading', { name: 'Preview Editor Journey' })).toBeVisible();
    await switchToPreviewTab(pageBob);
    await expect(pageBob.getByTestId('preview-editor')).toBeVisible();
    await expect(pageBob.locator('p[data-block-from]', { hasText: ORIGINAL_FIRST_PARAGRAPH })).toBeVisible();
  });

  await test.step('Bob edits the first paragraph directly in Vista previa', async () => {
    const paragraph = pageBob.locator('p[data-block-from]', { hasText: ORIGINAL_FIRST_PARAGRAPH });
    await paragraph.click();
    await pageBob.keyboard.press('End');
    await pageBob.keyboard.type(EDIT_SUFFIX);

    await expect(paragraph).toHaveText(`${ORIGINAL_FIRST_PARAGRAPH}${EDIT_SUFFIX}`);
  });

  const expectedBody = buildBody(`${ORIGINAL_FIRST_PARAGRAPH}${EDIT_SUFFIX}`);

  await test.step('The Markdown tab shows the edit applied at the exact right offset, everything else identical', async () => {
    await expect.poll(() => readMarkdownSource(pageBob)).toBe(expectedBody);
  });

  await test.step('Alice (the other collaborator) sees the same edit propagate via the live Yjs sync', async () => {
    await switchToPreviewTab(pageAlice);
    const aliceParagraph = pageAlice.locator('p[data-block-from]', { hasText: ORIGINAL_FIRST_PARAGRAPH });
    await expect(aliceParagraph).toHaveText(`${ORIGINAL_FIRST_PARAGRAPH}${EDIT_SUFFIX}`);
    await expect.poll(() => readMarkdownSource(pageAlice)).toBe(expectedBody);
  });

  await test.step('The blame margin attributes the edited paragraph to Bob and the untouched one to Alice', async () => {
    await switchToPreviewTab(pageAlice);
    const editedParagraph = pageAlice.locator('p[data-block-from]', { hasText: ORIGINAL_FIRST_PARAGRAPH });
    const editedMarker = editedParagraph.getByTestId('blame-marker');
    await expect(editedMarker).toBeVisible();
    await expect(editedMarker).toHaveAttribute('aria-label', new RegExp(bob.id));

    const untouchedParagraph = pageAlice.locator('p[data-block-from]', { hasText: ORIGINAL_SECOND_LINE });
    const untouchedMarker = untouchedParagraph.getByTestId('blame-marker');
    await expect(untouchedMarker).toBeVisible();
    await expect(untouchedMarker).toHaveAttribute('aria-label', new RegExp(alice.id));
  });

  await test.step('Zero CSP violations fired during the whole flow, on either page', async () => {
    expect(await readCspViolations(pageAlice)).toEqual([]);
    expect(await readCspViolations(pageBob)).toEqual([]);
  });

  await contextAlice.close();
  await contextBob.close();
});
