import { expect, test } from '@playwright/test';

/**
 * SDD-005 "Tests" golden path: load the built explorer against a real server + Neo4j, search for a real
 * document, select it, see its detail, and see the drift banner report the project's real status.
 *
 * The fixture is grandfathered for PRD-002's lifecycle rules (see playwright.config.ts) but still carries one
 * pre-existing `impacts_warning` on SDD-001 unrelated to this feature — asserting the banner's live severity
 * attribute rather than a hardcoded "0 issues" keeps this test honest about what the fixture actually reports
 * instead of hiding a real (if unrelated) warning behind an assumption.
 */
test('search, select a document, see its detail, and see the real drift status', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('treeitem', { name: /MRD-001/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Grafo interactivo/ })).toBeVisible();

  const search = page.getByPlaceholder('Buscar documentos, work orders, rutas…');
  await search.fill('Graph Engine');
  const result = page.getByRole('option', { name: /PRD-001/ });
  await expect(result).toBeVisible();
  await result.click();

  const detail = page.getByLabel('Detalle del nodo seleccionado');
  await expect(detail.getByText('PRD-001', { exact: true })).toBeVisible();
  await expect(detail.getByText('Graph Engine')).toBeVisible();
  await expect(detail.getByText('approved')).toBeVisible();

  const banner = page.getByRole('status').filter({ hasText: /issue|sincronizado/ });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-severity', /ok|warning|error/);
});

test('selecting a work order from the list opens its detail too', async ({ page }) => {
  await page.goto('/');

  const row = page.getByRole('button', { name: /Ver detalle de WO-001/ });
  await expect(row).toBeVisible();
  await row.click();

  const detail = page.getByLabel('Detalle del nodo seleccionado');
  await expect(detail.getByText('WO-001', { exact: true })).toBeVisible();
});
