/**
 * WO-387 — accessibility gate for SDD-014's lossless preview editor: an axe-core scan of the editable
 * surface, formatting toolbar, and comment trigger (see `./accessibility-helpers.ts` for the shared
 * harness/scan setup this file and `accessibility-screens.spec.ts` both use).
 */
import { expect, test } from '@playwright/test';
import { startJourney, stopJourney, type Journey } from './harness.js';
import { createPrdDocument, expectNoViolations, login, switchToMarkdownTab } from './accessibility-helpers.js';

let journey: Journey;

test.beforeAll(async () => {
  journey = await startJourney();
});

test.afterAll(async () => {
  if (journey) await stopJourney(journey);
});

test.describe('Accessibility gate: lossless preview editor (WO-387)', () => {
  test('the preview editor surface, toolbar, and comment trigger are clean', async ({ page }) => {
    const { baseUrl, org, project, alice } = journey;
    await login(page, baseUrl, alice.email);

    await page.goto(`${baseUrl}/o/${org.slug}/p/${project.slug}/documents`);
    await createPrdDocument(page, 'A11y Editor Surface');

    await switchToMarkdownTab(page);
    await page.locator('.cm-content').click();
    // A fresh PRD's body isn't empty -- "Nuevo documento" seeds it from the PRD template ("## Resumen/##
    // Requisitos/## Fuera de alcance"), so select-all before typing to replace it outright rather than
    // merge into one of those headings (which leaves no plain `<p>` for the click below to find).
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Select this sentence to comment.');
    await page.getByRole('tab', { name: 'Vista previa' }).click();

    const editable = page.getByRole('textbox', { name: 'Cuerpo del documento' });
    await expect(editable).toBeVisible();
    await expect(editable).toHaveAttribute('aria-multiline', 'true');

    // Select the sentence: the "Comentar selección" trigger and the formatting toolbar's `aria-pressed`
    // buttons only render with a real, non-collapsed selection (Toolbar.tsx/PreviewEditor.tsx).
    await page.locator('p[data-block-from]').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');

    await expect(page.getByRole('toolbar', { name: 'Formato' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Comentar selección' })).toBeVisible();
    await expectNoViolations(page, 'PreviewEditor with an active selection (toolbar + comment trigger visible)');

    // The link popover: keyboard-operable, closes on Escape, and never drops focus to `document.body`
    // (Toolbar.tsx's WO-387 fix). A real browser collapses the document selection the instant the
    // popover's own input auto-focuses, so the "Enlace" trigger is disabled again by the time it closes —
    // focus falls back to the toolbar itself rather than a (correctly) now-unfocusable disabled button.
    const linkButton = page.getByRole('button', { name: 'Enlace' });
    const toolbar = page.getByRole('toolbar', { name: 'Formato' });
    await linkButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('URL del enlace')).toBeFocused();
    await expectNoViolations(page, 'PreviewEditor with the link popover open');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('URL del enlace')).toHaveCount(0);
    await expect(linkButton).toBeDisabled();
    await expect(toolbar).toBeFocused();
  });
});
