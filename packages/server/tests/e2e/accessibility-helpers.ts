/**
 * WO-369/WO-387 (accessibility gates): shared helpers for `accessibility-screens.spec.ts` and
 * `accessibility-editor.spec.ts` — an axe-core scan (via `@axe-core/playwright`) of every major ported
 * screen (SDD-013's frontend port) and of the lossless preview editor (SDD-014), reusing the exact same
 * real-server bootstrap (`./harness.ts`, real Postgres/Neo4j, the real built `@prdm/app` bundle)
 * `full-journey.spec.ts` already uses, rather than a second, parallel a11y-testing setup.
 *
 * Every scan asserts zero violations for the WCAG 2.0/2.1 A/AA rule tags — the same tags axe-core's own
 * `withTags` documentation recommends for a WCAG-conformance check, neither the full "best-practice" set
 * (noisier, more subjective) nor an unscoped `analyze()` (pulls in rules with no WCAG mapping at all).
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';
import { PASSWORD } from './harness.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function login(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/o\//);
}

/** Fails with the full list of violations (rule id, impact, every affected selector) rather than
 * Playwright's own truncated object diff — this is the detail an actual fix needs. */
export async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results: AxeResults = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), html: node.html, reason: node.failureSummary })),
  }));
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

export async function switchToMarkdownTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Markdown' }).click();
}

/** Creates a PRD via the "Nuevo documento" modal and navigates to it. `Título` is scoped to the dialog:
 * `DocumentsList.tsx`'s own search box shares the same accessible name at the page level. */
export async function createPrdDocument(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Nuevo documento' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo de documento').selectOption('PRD');
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByRole('button', { name: 'Crear' }).click();

  // Scoped to the row whose own "Título" cell has this exact text — other tests in the same project's
  // documents list leave earlier PRDs behind, so a bare `getByRole('link', { name: /^PRD-\d+$/ })` would
  // otherwise match every one of them.
  const link = page.getByRole('row', { name: title }).getByRole('link', { name: /^PRD-\d+$/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}
