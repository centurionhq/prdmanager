/**
 * WO-201 (SDD-010 §Tests, "E2E Playwright del recorrido completo"): a single, coherent journey through
 * the real product — never a fixed `page.waitForTimeout(...)` anywhere in this file (this codebase's own
 * zero-tolerance policy on wall-clock waits, per two earlier real CI failures); every wait is Playwright's
 * own auto-retrying `expect(...)`/locator visibility, on a real event.
 *
 *  1. Two browser contexts (Alice, admin; Bob, editor) co-edit the same PRD, Bob comments on a selection,
 *     and both see each other's real blame attribution (Phase 5's realtime collab, exercised end to end —
 *     not re-testing its unit-level correctness).
 *  2. The conversational agent (`FakeLlmClient`, never a real DeepSeek call) proposes an edit; Alice
 *     accepts it.
 *  3. Alice (admin) publishes the PRD, then an SDD that architects it.
 *  4. Publishing the SDD generates the expected work order (SDD-007's publish flow, WO-138).
 *  5. A remote MCP client (`StreamableHTTPClientTransport`, matching Phase 7's own MCP integration
 *     tests) claims and completes that work order — but only after a code report carrying a test/fake
 *     GitHub OIDC token (WO-179's test-JWKS injection pattern) establishes its commit as baseline-verified.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SignJWT } from 'jose';
import { expect, request as playwrightRequest, test, type BrowserContext, type Page } from '@playwright/test';
import { GITHUB_OIDC_ISSUER } from '../../src/auth/github-oidc.js';
import { githubOidcClaims, startJourney, stopJourney, OIDC_KID_EXPORT, PASSWORD, type Journey } from './harness.js';

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

/** `keyboard.type()` sending a literal `\n` inside its string does not reliably produce a real
 * CodeMirror newline the way an actual `Enter` keypress does — each line is typed and committed with
 * its own explicit `Enter` between them instead. */
async function typeLines(page: Page, text: string): Promise<void> {
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    if (line.length > 0) await page.keyboard.type(line);
  }
}

/** A freshly created document's live `Y.Doc` starts genuinely empty (its `working_state` is only ever
 * written once a real collab edit happens — the template used to seed `document_versions` never seeds
 * the live document itself), so the very first edit can just click into `.cm-content` and type: the
 * caret lands at the document's only (empty) line. */
async function typeIntoEmptyBody(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await typeLines(page, text);
}

/** Appends `text` as a fresh new line after whatever the body currently ends with. `Control+End` (not a
 * click on a specific `.cm-line` matched by text) is what's actually reliable once the body has wrapped
 * onto more than one visual row (`cm-lineWrapping`): a click's default keymap `End` only goes to the end
 * of the *visual* row under the cursor, not the logical line's real end, and this document's only
 * content so far is exactly what the previous step appended — so "the real end of the document" and
 * "right after that content" are the same place. */
async function appendAtEnd(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await typeLines(page, text);
}

/**
 * "Solicitar revisión" freezes a `document_versions` snapshot of whatever the *server's own* live
 * `Y.Doc` currently holds — but a frontmatter `fill()`/`blur()` (or a body `type()`) only writes the
 * *local* Yjs doc synchronously; the actual websocket message to the server is asynchronous. Clicking
 * "Solicitar revisión" immediately afterward can therefore freeze a version snapshot one message too
 * early, publishing against stale data even though the editor's own live validation panel (reading the
 * live doc directly) already looks correct. A second, independent client observing the same field is a
 * real event (Hocuspocus only ever broadcasts a change to other clients *after* applying it itself) —
 * never a fixed wait — so opening a throwaway probe page in the same browser context and waiting for it
 * to see the field is what actually proves the edit reached the server before the next step runs.
 */
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
    await expect(probe.locator('.cm-content')).toContainText(expectedText);
  } finally {
    await probe.close();
  }
}

test('full product journey', async ({ browser }) => {
  test.setTimeout(150_000);
  const { baseUrl, org, project, alice, bob, ciTokenSecret, mcpTokenSecret, oidcPrivateKey } = journey;

  const contextAlice = await browser.newContext();
  const contextBob = await browser.newContext();
  const pageAlice = await contextAlice.newPage();
  const pageBob = await contextBob.newPage();

  await login(pageAlice, baseUrl, alice.email);
  await login(pageBob, baseUrl, bob.email);

  let prdDocId = '';
  let fbDocIdRef = '';

  await test.step('Alice creates the PRD', async () => {
    await pageAlice.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await pageAlice.getByRole('button', { name: 'Nuevo documento' }).click();
    await pageAlice.getByLabel('Tipo de documento').selectOption('PRD');
    await pageAlice.getByLabel('Título').fill('Product Vision');
    await pageAlice.getByRole('button', { name: 'Crear' }).click();

    const link = pageAlice.getByRole('link', { name: /^PRD-\d+$/ });
    await expect(link).toBeVisible();
    prdDocId = (await link.textContent())!.trim();
    await link.click();
    await expect(pageAlice.getByRole('heading', { name: 'Product Vision' })).toBeVisible();

    // The live collab document starts empty (see `typeIntoEmptyBody`'s own doc comment) — the frontmatter
    // form's "Título" is filled here for real, not just the one-off title `NewDocumentForm` sent to create
    // the document's very first `document_versions` row.
    await pageAlice.getByLabel('Título').fill('Product Vision');
    await pageAlice.getByLabel('Título').blur();
  });

  await test.step('Bob opens the same PRD', async () => {
    await pageBob.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${prdDocId}`);
    await expect(pageBob.getByRole('heading', { name: 'Product Vision' })).toBeVisible();
    await expect(pageBob.locator('.cm-content')).toBeVisible();
  });

  await test.step('Alice and Bob co-edit the body', async () => {
    await typeIntoEmptyBody(pageAlice, 'We will ship real-time collaboration to every organization.');
    await expect(pageBob.locator('.cm-content')).toContainText('ship real-time collaboration');

    await appendAtEnd(pageBob, 'Bob adds: comments and presence should feel instant.');
    await expect(pageAlice.locator('.cm-content')).toContainText('comments and presence should feel instant');
  });

  await test.step('Bob comments on his own selection, and Alice sees it too', async () => {
    await pageBob.locator('.cm-line', { hasText: 'Bob adds' }).first().click();
    await pageBob.keyboard.press('Home');
    await pageBob.keyboard.down('Shift');
    await pageBob.keyboard.press('End');
    await pageBob.keyboard.up('Shift');
    await pageBob.getByRole('button', { name: 'Comentar selección' }).click();
    await pageBob.getByLabel('Nuevo comentario').fill('Let’s keep latency low here.');
    await pageBob.getByRole('button', { name: 'Comentar', exact: true }).click();

    const comments = pageAlice.getByRole('region', { name: 'Comentarios' });
    await expect(comments.getByText('Let’s keep latency low here.')).toBeVisible();
  });

  await test.step('Both see real blame attribution for each other', async () => {
    await pageAlice.reload();
    await expect(pageAlice.locator('.cm-content')).toContainText('ship real-time collaboration');
    const markers = pageAlice.locator('button.cm-blame-marker');
    await expect(markers.first()).toBeVisible();
    const labels = await markers.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') ?? ''));
    const joined = labels.join(' | ');
    expect(joined).toContain(alice.id);
    expect(joined).toContain(bob.id);
  });

  await test.step('The agent proposes an edit and Alice accepts it', async () => {
    await pageAlice.getByLabel('Mensaje para el agente').fill('Please tighten the wording of the vision statement.');
    await pageAlice.getByRole('button', { name: 'Enviar' }).click();

    const acceptButton = pageAlice.getByRole('button', { name: 'Aceptar' });
    await expect(acceptButton).toBeVisible();
    await acceptButton.click();

    await expect(pageAlice.getByText('Aplicado ✓')).toBeVisible();
    await expect(pageAlice.locator('.cm-content')).toContainText('ship real-time collaborative editing');
  });

  await test.step('Alice creates and publishes a Feedback that justifies the PRD (PRD-002 lifecycle)', async () => {
    await pageAlice.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await pageAlice.getByRole('button', { name: 'Nuevo documento' }).click();
    await pageAlice.getByLabel('Tipo de documento').selectOption('FB');
    await pageAlice.getByLabel('Título').fill('Customers ask for real-time collaboration');
    await pageAlice.getByRole('button', { name: 'Crear' }).click();

    const link = pageAlice.getByRole('link', { name: /^FB-\d+$/ });
    await expect(link).toBeVisible();
    const fbDocId = (await link.textContent())!.trim();
    await link.click();

    await pageAlice.getByLabel('Título').fill('Customers ask for real-time collaboration');
    await pageAlice.getByLabel('Título').blur();
    await pageAlice.getByLabel('Fuente').fill('other');
    await pageAlice.getByLabel('Fuente').blur();
    // `root: true` (never "Informa a" pointing forward at the not-yet-published PRD): a publish-mode
    // link check requires every relation target to already be *published*, so a forward
    // `informs: [PRD-001]` here would fail with "INFORMS links to missing PRD-001" while the PRD is
    // still in review. The PRD instead links *back* to this Feedback via its own `justified_by` once
    // this Feedback is published (SDD-007's own doc comment: `checkLifecycle`'s `hasJustification`
    // only needs the Feature's own `justified_by` to be non-empty, independent of this document).
    await pageAlice.getByLabel('Raíz (excepción de ciclo de vida)').check();
    await typeIntoEmptyBody(pageAlice, 'Several customers asked for live multi-user editing.');

    const fbUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${fbDocId}`;
    const fbProbe = await contextAlice.newPage();
    await fbProbe.goto(fbUrl);
    await expect(fbProbe.getByLabel('Raíz (excepción de ciclo de vida)')).toBeChecked();
    await fbProbe.close();
    await waitForBodyOnServer(contextAlice, fbUrl, 'Several customers asked for live multi-user editing.');

    await pageAlice.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(pageAlice.getByText(/in_review/)).toBeVisible();
    await pageAlice.getByRole('button', { name: 'Publicar' }).click();
    await expect(pageAlice.getByText(/published/)).toBeVisible();

    fbDocIdRef = fbDocId;
  });

  await test.step('Alice publishes the PRD', async () => {
    await pageAlice.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${prdDocId}`);
    await pageAlice.getByLabel('Justificado por').fill(fbDocIdRef);
    await pageAlice.getByLabel('Justificado por').blur();

    await waitForFieldOnServer(contextAlice, `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${prdDocId}`, 'Justificado por', fbDocIdRef);

    // The live validation panel only refreshes from its own `validation:updated` broadcast (recomputed
    // server-side *after* a change lands) — waiting for the specific "no justification" error to clear
    // is a real event this test can wait on, not a guess at how long that recompute takes.
    await expect(pageAlice.getByText(/has no justification/)).toBeHidden();

    await pageAlice.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(pageAlice.getByText(/in_review/)).toBeVisible();
    await pageAlice.getByRole('button', { name: 'Publicar' }).click();
    await expect(pageAlice.getByText(/published/)).toBeVisible();
  });

  await test.step('Alice creates and publishes an SDD that architects the PRD', async () => {
    await pageAlice.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await pageAlice.getByRole('button', { name: 'Nuevo documento' }).click();
    await pageAlice.getByLabel('Tipo de documento').selectOption('SDD');
    await pageAlice.getByLabel('Título').fill('Collaboration System Design');
    await pageAlice.getByRole('button', { name: 'Crear' }).click();

    const link = pageAlice.getByRole('link', { name: /^SDD-\d+$/ });
    await expect(link).toBeVisible();
    const sddDocId = (await link.textContent())!.trim();
    await link.click();
    await expect(pageAlice.getByRole('heading', { name: 'Collaboration System Design' })).toBeVisible();

    await pageAlice.getByLabel('Título').fill('Collaboration System Design');
    await pageAlice.getByLabel('Título').blur();
    await pageAlice.getByLabel('Arquitecta a').fill(prdDocId);
    await pageAlice.getByLabel('Arquitecta a').blur();
    await pageAlice.getByLabel('Rutas impactadas').fill('packages/app/src/e2e/vision.ts');
    await pageAlice.getByLabel('Rutas impactadas').blur();

    // The live body starts empty (see `typeIntoEmptyBody`) — typed fresh here, not edited from a
    // template, so the "## Tareas" checklist item `generateWorkOrders` (SDD-007/WO-138) looks for is
    // real, present text rather than the template's own empty `- [ ]` placeholder line.
    await typeIntoEmptyBody(pageAlice, '## Tareas\n\n- [ ] Wire the shared vision banner into the dashboard');

    const sddUrl = `${baseUrl}/o/${org.slug}/p/${project.slug}/documents/${sddDocId}`;
    await waitForFieldOnServer(contextAlice, sddUrl, 'Arquitecta a', prdDocId);
    await waitForFieldOnServer(contextAlice, sddUrl, 'Rutas impactadas', 'packages/app/src/e2e/vision.ts');
    await waitForBodyOnServer(contextAlice, sddUrl, 'Wire the shared vision banner into the dashboard');

    await pageAlice.getByRole('button', { name: 'Solicitar revisión' }).click();
    await expect(pageAlice.getByText(/in_review/)).toBeVisible();
    await pageAlice.getByRole('button', { name: 'Publicar' }).click();
    await expect(pageAlice.getByText(/published/)).toBeVisible();
    await expect(pageAlice.getByText(/Work orders generados: 1/)).toBeVisible();
  });

  let workOrderId = '';
  await test.step('Publishing the SDD generated exactly one work order', async () => {
    const res = await pageAlice.request.get(`${baseUrl}/api/app/organizations/${org.slug}/projects/${project.slug}/documents?kind=WO`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { documents: { docId: string; workflowState: string }[] };
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]!.workflowState).toBe('published');
    workOrderId = body.documents[0]!.docId;
  });

  const headSha = 'e2e0'.padEnd(40, 'a');

  await test.step('A code report with a test GitHub OIDC token establishes the commit as baseline-verified', async () => {
    // `/api/v1/*` Bearer routes reject any request that also carries a `Cookie` header outright
    // (`bearer-auth.ts`'s own doc comment: a Bearer route never also accepts a session, so a request
    // smuggling both is treated as an attack rather than "prefer the cookie" or "prefer the token") —
    // `pageAlice.request` shares `contextAlice`'s cookie jar, so a real CI/MCP client's own cookie-less
    // request is a fresh, separate `APIRequestContext` instead.
    const api = await playwrightRequest.newContext();

    const governanceRes = await api.get(`${baseUrl}/api/v1/projects/${project.graphProjectId}/governance`, {
      headers: { authorization: `Bearer ${ciTokenSecret}` },
    });
    expect(governanceRes.ok()).toBe(true);
    const graphVersion = ((await governanceRes.json()) as { graphVersion: string }).graphVersion;

    const oidcToken = await new SignJWT(githubOidcClaims(headSha))
      .setProtectedHeader({ alg: 'RS256', kid: OIDC_KID_EXPORT })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience(baseUrl)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(oidcPrivateKey);

    const reportRes = await api.post(`${baseUrl}/api/v1/projects/${project.graphProjectId}/code-reports`, {
      headers: {
        authorization: `Bearer ${ciTokenSecret}`,
        'idempotency-key': `e2e-${headSha}`,
        'x-prdm-github-oidc-token': oidcToken,
        'content-type': 'application/json',
      },
      data: {
        schema_version: 1,
        client: { prdm_version: '0.2.0-e2e', hash_algo_version: 1 },
        branch: 'main',
        head_sha: headSha,
        docs_graph_version: graphVersion,
        impacts_hashes: {},
        governed: [],
        governed_warnings: [],
        commits: [
          {
            sha: headSha,
            parents: [],
            author: 'Alice E2E',
            date: new Date().toISOString(),
            subject: `feat: wire the shared vision banner\n\nRefs: ${workOrderId}`,
            refs: [workOrderId],
            files: ['packages/app/src/e2e/vision.ts'],
          },
        ],
        dirty: [],
      },
    });
    expect(reportRes.ok()).toBe(true);
    const reportBody = (await reportRes.json()) as { mode: string };
    expect(reportBody.mode).toBe('baseline');

    await api.dispose();
  });

  await test.step('A remote MCP client claims and completes the work order', async () => {
    const client = new Client({ name: 'e2e-client', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${project.graphProjectId}`), {
      requestInit: { headers: { authorization: `Bearer ${mcpTokenSecret}` } },
    });
    await client.connect(transport);

    const claim = await client.callTool({ name: 'claim_work_order', arguments: { id: workOrderId, assignee: 'agent:e2e-bot' } });
    expect(claim.isError).toBeFalsy();

    const complete = await client.callTool({ name: 'complete_work_order', arguments: { id: workOrderId, commit_sha: headSha } });
    expect(complete.isError).toBeFalsy();

    await client.close();
  });

  await test.step('The work order is now done', async () => {
    const res = await pageAlice.request.get(`${baseUrl}/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${workOrderId}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { document: { publishedRaw: string | null } };
    expect(body.document.publishedRaw ?? '').toContain('status: "done"');
  });

  await contextAlice.close();
  await contextBob.close();
});
