/**
 * SDD-079: cobertura e2e permanente, en navegador real y contra el servidor real, del recorrido «Planta →
 * Árbol filtrado por `?sinCodigo=1`». Cubre:
 *
 * - el endpoint `GET .../metrics` (`traceability.orphanFeatures`, coherente con `featuresTraced`/`featuresTotal`);
 * - el KPI accionable de la Planta («Features trazadas», link con `href` al Árbol filtrado);
 * - el chip «Sin código (N)», su `aria-pressed`, el badge de la fila huérfana y el botón «atrás» (manda el query param);
 * - axe sobre la Planta y el Árbol filtrado a 1440 y 375 px;
 * - la lista vacía (D6): sin huérfanas no hay chip ni badge y la Planta dice «Todas trazadas».
 *
 * El sembrado es real: un `FB` raíz y un `BC` publicados por la UI (mismo recorrido que `planta-kpi-375.spec.ts`),
 * un code report firmado con OIDC (sin él el proyecto queda `awaitingFirstReport` y la banda no se pinta) y la
 * feature trazada directo en el grafo de test.
 *
 * Deja afuera el desborde horizontal del Árbol a 375 px: es preexistente y se trata por separado, no se asierta.
 */
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { expect, request as playwrightRequest, test, type BrowserContext, type Page } from '@playwright/test';
import neo4j, { type Driver } from 'neo4j-driver';
import { loadNeo4jConfig } from '@prdm/core';
import { GITHUB_OIDC_ISSUER } from '../../src/auth/github-oidc.js';
import { expectNoViolations, login } from './accessibility-helpers.js';
import { OIDC_KID_EXPORT, githubOidcClaims, startJourney, stopJourney, type Journey } from './harness.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const TRACED_FEATURE_ID = 'PRD-901';

interface MetricsBody {
  traceability: { featuresTotal: number; featuresTraced: number; orphanFeatures: { id: string }[] };
}

let journey: Journey;

test.beforeAll(async () => {
  journey = await startJourney();
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

function testDriver(): Driver {
  const dev = loadNeo4jConfig(REPO_ROOT, process.env);
  const uri = process.env.NEO4J_TEST_URI ?? 'neo4j://127.0.0.1:7688';
  if (uri === dev.uri) throw new Error('refusing to seed the development Neo4j instance');
  return neo4j.driver(uri, neo4j.auth.basic(dev.username, dev.password), { disableLosslessIntegers: true });
}

async function seed(driver: Driver, cypher: string, params: Record<string, unknown>): Promise<void> {
  const session = driver.session();
  try {
    await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function switchToMarkdownTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Markdown' }).click();
}

async function typeIntoEmptyBody(page: Page, text: string): Promise<void> {
  await switchToMarkdownTab(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  // `insertText` es un único update de Yjs; `type()` genera uno por tecla y ensucia los encabezados `##`.
  await page.keyboard.insertText(text);
}

async function createDocument(page: Page, kind: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Nuevo documento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo de documento').selectOption(kind);
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByRole('button', { name: 'Crear' }).click();
}

async function publishFromReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page.getByRole('button', { name: /^Publicar versión \d+$/ }).click();
}

/** Una página descartable es la prueba de que el servidor ya persistió el cuerpo (Hocuspocus sólo aplica y difunde). */
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

async function fetchMetrics(page: Page, path: string): Promise<{ status: number; body: MetricsBody }> {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
    return { status: res.status, body: (await res.json()) as MetricsBody };
  }, path);
}

test('SDD-079: la Planta nombra las features sin código y el Árbol las filtra con ?sinCodigo=1', async ({ browser }) => {
  test.setTimeout(300_000);
  const { baseUrl, org, project, alice } = journey;
  const projectHome = `${baseUrl}/o/${org.slug}/p/${project.slug}`;
  const arbolUrl = `${projectHome}/arbol`;
  const metricsPath = `/api/app/organizations/${org.slug}/projects/${project.slug}/metrics`;

  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, baseUrl, alice.email);

  // ---------- 2. sembrar por la UI: FB raíz publicado + BC justificado por él, publicado ----------
  await page.goto(`${projectHome}/documents`);
  await createDocument(page, 'FB', 'SDD-079: la Planta nombra lo que falta');
  const fbLink = page.getByRole('link', { name: /^FB-\d+$/ });
  await expect(fbLink).toBeVisible();
  const fbDocId = ((await fbLink.textContent()) ?? '').trim();
  await fbLink.click();
  await expect(page.getByRole('heading', { level: 1, name: 'SDD-079: la Planta nombra lo que falta' })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('SDD-079: la Planta nombra lo que falta');
  await page.getByLabel('Título', { exact: true }).blur();
  await page.getByLabel('Fuente').fill('other');
  await page.getByLabel('Fuente').blur();
  await page.getByLabel('Raíz (excepción de ciclo de vida)').check();
  await typeIntoEmptyBody(page, 'SDD-079: la Planta debe nombrar las features sin código.');
  await waitForBodyOnServer(
    context,
    `${projectHome}/documents/${fbDocId}`,
    'SDD-079: la Planta debe nombrar las features sin código.',
  );
  await page.getByRole('tab', { name: 'Validación' }).click();
  await page.getByRole('button', { name: 'Solicitar revisión' }).click();
  await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
  await publishFromReview(page);
  await expect(page.locator('p', { hasText: /published/ })).toBeVisible();

  await page.goto(`${projectHome}/documents`);
  await createDocument(page, 'BC', 'SDD-079: caso de negocio sin código');
  const bcLink = page.getByRole('link', { name: /^BC-\d+$/ });
  await expect(bcLink).toBeVisible();
  const bcDocId = ((await bcLink.textContent()) ?? '').trim();
  await bcLink.click();
  await expect(page.getByRole('heading', { level: 1, name: 'SDD-079: caso de negocio sin código' })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('SDD-079: caso de negocio sin código');
  await page.getByLabel('Título', { exact: true }).blur();
  await page.getByLabel('Justificado por').fill(fbDocId);
  await page.getByLabel('Justificado por').blur();
  await typeIntoEmptyBody(
    page,
    '## Problema\n\nNo se ve qué features no tienen código.\n\n## Impacto esperado\n\nTrazabilidad accionable.\n\n## Métrica de éxito\n\nEl chip y el KPI coinciden.\n\n## Costo estimado\n\nUna tarde.',
  );
  await waitForBodyOnServer(context, `${projectHome}/documents/${bcDocId}`, '## Costo estimado');
  await page.getByRole('tab', { name: 'Validación' }).click();
  await page.getByRole('button', { name: 'Solicitar revisión' }).click();
  await expect(page.locator('p', { hasText: /in_review/ })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Validación' }).click();
  await publishFromReview(page);
  await expect(page.locator('p', { hasText: /published/ })).toBeVisible();

  // ---------- 3. code report real (con OIDC): sin él la banda de KPIs no se pinta ----------
  const api = await playwrightRequest.newContext();
  const governanceRes = await api.get(`${baseUrl}/api/v1/projects/${project.graphProjectId}/governance`, {
    headers: { authorization: `Bearer ${journey.ciTokenSecret}` },
  });
  expect(governanceRes.ok()).toBe(true);
  const graphVersion = ((await governanceRes.json()) as { graphVersion: string }).graphVersion;
  const headSha = 'e2e079'.padEnd(40, 'b');
  const oidcToken = await new SignJWT(githubOidcClaims(headSha))
    .setProtectedHeader({ alg: 'RS256', kid: OIDC_KID_EXPORT })
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(baseUrl)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(journey.oidcPrivateKey);
  const reportRes = await api.post(`${baseUrl}/api/v1/projects/${project.graphProjectId}/code-reports`, {
    headers: {
      authorization: `Bearer ${journey.ciTokenSecret}`,
      'idempotency-key': `e2e-sdd079-${headSha}`,
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
      commits: [],
      dirty: [],
    },
  });
  expect(reportRes.ok()).toBe(true);
  await api.dispose();

  // ---------- 4. sembrar en el grafo la feature trazada: el BC queda huérfano ----------
  const driver = testDriver();
  const p = project.graphProjectId;
  try {
    await seed(
      driver,
      `MERGE (f:Node:Feature {project_id: $p, id: '${TRACED_FEATURE_ID}'})
       SET f.ref = '${TRACED_FEATURE_ID}', f.kind = 'PRD', f.title = 'SDD-079: feature con código', f.status = 'approved'
       MERGE (bp:Node:Blueprint {project_id: $p, id: 'SDD-901'})
       SET bp.ref = 'SDD-901', bp.kind = 'SDD', bp.title = 'SDD-079: blueprint de prueba', bp.status = 'active'
       MERGE (c:CodeRef {project_id: $p, key: 'code:packages/app/src/e2e/sdd-079.ts'})
       SET c.path = 'packages/app/src/e2e/sdd-079.ts', c.ref = 'code:code:packages/app/src/e2e/sdd-079.ts'
       MERGE (c)-[g:GOVERNED_BY]->(bp) SET g.status = 'synced', g.reason = 'code_changed'
       MERGE (bp)-[:ARCHITECTS]->(f)`,
      { p },
    );

    // ---------- 5. el endpoint HTTP ----------
    const http = await fetchMetrics(page, metricsPath);
    expect(http.status).toBe(200);
    expect(http.body.traceability.orphanFeatures.map((o) => o.id)).toEqual([bcDocId]);
    expect(http.body.traceability.featuresTraced).toBe(1);
    expect(http.body.traceability.featuresTotal).toBe(2);
    expect(http.body.traceability.featuresTraced + http.body.traceability.orphanFeatures.length).toBe(
      http.body.traceability.featuresTotal,
    );

    // ---------- 6. la Planta a 1440 px ----------
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(projectHome);
    await expect(page.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    const strip = page.getByRole('region', { name: 'Indicadores de la planta' });
    await expect(strip).toBeVisible();
    await expect(strip.getByText('Features trazadas', { exact: true })).toBeVisible();
    const kpiLink = strip.getByRole('link', { name: /1 de 2 features trazadas; faltan 1/ });
    await expect(kpiLink).toBeVisible();
    await expect(kpiLink).toHaveText('1/2');
    await expect(kpiLink).toHaveAttribute('href', `/o/${org.slug}/p/${project.slug}/arbol?sinCodigo=1`);
    await expect(strip.getByText('faltan 1', { exact: true })).toBeVisible();
    await expectNoViolations(page, 'Planta (KPI accionable, 1440)');

    // ---------- 7. el link abre el Árbol ya filtrado ----------
    await kpiLink.click();
    await expect(page).toHaveURL(/\/arbol\?sinCodigo=1$/);
    const chip = page.getByRole('button', { name: 'Sin código (1)' });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'feature sin código' })).toHaveText('1 feature sin código');
    const treeitems = page.getByRole('treeitem');
    await expect(treeitems).toHaveCount(1);
    await expect(page.getByRole('treeitem', { name: new RegExp(bcDocId) })).toBeVisible();
    await expect(page.getByText('Sin código', { exact: true })).toHaveCount(1);

    // ---------- 9a. a11y del Árbol filtrado a 1440 (estado del paso 7) ----------
    await expectNoViolations(page, 'Árbol filtrado (?sinCodigo=1, 1440)');

    // ---------- 8. apagar el chip y volver atrás: el query param manda ----------
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`${project.slug}/arbol$`));
    await expect(page.getByRole('button', { name: 'Sin código (1)' })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => treeitems.count()).toBeGreaterThan(1);
    await expect(page.getByRole('treeitem', { name: new RegExp(TRACED_FEATURE_ID) })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/arbol\?sinCodigo=1$/);
    await expect(page.getByRole('button', { name: 'Sin código (1)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(treeitems).toHaveCount(1);

    // ---------- 8b. a11y del Árbol SIN filtro a 1440: filas reales (huérfana + trazada), lo que el gate de a11y no ve (FB-218) ----------
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${arbolUrl}`);
    await expect(page.getByRole('tree')).toBeVisible();
    await expect(treeitems).toHaveCount(2);
    await expect(page.getByRole('treeitem', { name: new RegExp(bcDocId) })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: new RegExp(TRACED_FEATURE_ID) })).toBeVisible();
    // El badge es de la fila huérfana (no del filtro): lo lleva el BC y no la feature trazada.
    await expect(page.getByText('Sin código', { exact: true })).toHaveCount(1);
    await expect(
      page.getByRole('treeitem', { name: new RegExp(bcDocId) }).getByText('Sin código', { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('treeitem', { name: new RegExp(TRACED_FEATURE_ID) }).getByText('Sin código', { exact: true }),
    ).toHaveCount(0);
    await expectNoViolations(page, 'Árbol sin filtro (1440)');

    // ---------- 8c. a11y del Árbol SIN filtro a 375 px (el desborde preexistente va por separado) ----------
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${arbolUrl}`);
    await expect(page.getByRole('tree')).toBeVisible();
    await expect(treeitems).toHaveCount(2);
    await expectNoViolations(page, 'Árbol sin filtro (375)');

    // ---------- 9b. a11y del Árbol filtrado a 375 px (el desborde preexistente va por separado) ----------
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${arbolUrl}?sinCodigo=1`);
    await expect(page.getByRole('button', { name: 'Sin código (1)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(treeitems).toHaveCount(1);
    await expectNoViolations(page, 'Árbol filtrado (?sinCodigo=1, 375)');

    // ---------- 10. lista vacía (D6): trazar también el BC ----------
    await seed(
      driver,
      `MATCH (bc:Feature {project_id: $p, id: $bc})
       MERGE (bp2:Node:Blueprint {project_id: $p, id: 'SDD-902'})
       SET bp2.ref = 'SDD-902', bp2.kind = 'SDD', bp2.title = 'SDD-079: blueprint del BC', bp2.status = 'active'
       MERGE (c2:CodeRef {project_id: $p, key: 'code:packages/app/src/e2e/sdd-079-bc.ts'})
       SET c2.path = 'packages/app/src/e2e/sdd-079-bc.ts', c2.ref = 'code:code:packages/app/src/e2e/sdd-079-bc.ts'
       MERGE (c2)-[g2:GOVERNED_BY]->(bp2) SET g2.status = 'synced'
       MERGE (bp2)-[:ARCHITECTS]->(bc)`,
      { p, bc: bcDocId },
    );

    const page2 = await context.newPage();
    await page2.setViewportSize({ width: 1440, height: 900 });
    await page2.goto(projectHome);
    const http2 = await fetchMetrics(page2, metricsPath);
    expect(http2.body.traceability.featuresTraced).toBe(2);
    expect(http2.body.traceability.orphanFeatures).toEqual([]);

    await page2.goto(projectHome);
    await expect(page2.getByRole('heading', { level: 1, name: 'Planta' })).toBeVisible();
    const strip2 = page2.getByRole('region', { name: 'Indicadores de la planta' });
    await expect(strip2.getByRole('link', { name: /features trazadas/ })).toHaveCount(0);
    await expect(strip2.getByText('Todas trazadas', { exact: true })).toBeVisible();
    await expect(strip2.getByText('2/2', { exact: true })).toBeVisible();

    await page2.goto(`${arbolUrl}?sinCodigo=1`);
    await expect(page2.getByRole('tree')).toBeVisible();
    await expect(page2.getByRole('treeitem').first()).toBeVisible();
    await expect(page2.getByRole('button', { name: /^Sin código/ })).toHaveCount(0);
    await expect(page2.getByText('Sin código', { exact: true })).toHaveCount(0);
    await expect.poll(() => page2.getByRole('treeitem').count()).toBeGreaterThan(1);
  } finally {
    // ---------- 11. cerrar el driver ----------
    await driver.close();
  }
});
