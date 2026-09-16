/**
 * Learning test — ADR-009 / WO-323.
 *
 * ADR-009's lossless editable preview plans to render a live view of a `Y.Text` in a `contentEditable`
 * element, and to always call `event.preventDefault()` unconditionally in its own `beforeinput` handler —
 * every actual mutation instead flows one-way from the `Y.Text` back into the DOM, so the browser's own
 * default contentEditable editing behavior must never be allowed to touch the DOM at all. This spec
 * checks that premise directly, in two real engines (Chromium and Firefox — no WebKit project exists in
 * this monorepo's Playwright setup at all, so this spec doesn't add one either), using real keyboard
 * interaction (`page.keyboard`, never `dispatchEvent`, since a synthetic `InputEvent` doesn't reproduce a
 * real browser's own trusted-event `beforeinput` dispatch in every engine).
 *
 * FOUND (both engines): an unconditional `preventDefault()` in `beforeinput` reliably blocks every
 * `inputType` exercised below — `insertText` (typing), `insertParagraph`/`insertLineBreak` (Enter),
 * `deleteContentBackward` (Backspace) and `deleteContentForward` (Delete) with an existing selection or
 * collapsed caret. `textContent` never changes from its seeded value in any case, in either browser.
 *
 * FOUND (IME composition — the one case ADR-009's own risk section calls out by name): Playwright's public
 * `Keyboard` API has no `compositionstart`/`compositionupdate`/`compositionend` simulation at all (verified
 * against `node_modules/playwright-core/types/types.d.ts`: `Keyboard` only exposes `down`/`up`/`press`/
 * `type`/`insertText`, no composition-specific method). `keyboard.insertText(text)` is the closest
 * approximation this API offers — real browsers use a similar underlying "insert this text with no
 * intervening keydown/keyup" primitive to apply the *result* of an IME composition once it commits.
 *
 * Exercising it below produced the single most important finding in this whole spec, and it's a genuine
 * cross-engine difference, not a quirk this spec smooths over: in **Chromium**, `keyboard.insertText` goes
 * through the normal `beforeinput` pipeline (`inputType: 'insertText'`) and an unconditional
 * `preventDefault()` blocks it exactly like typed `insertText`. In **Firefox**, `beforeinput` *does* fire
 * — with `inputType: 'insertCompositionText'`, Firefox's own read of what this API call represents — but
 * calling `preventDefault()` on it has **no effect**: the DOM mutates anyway (`textContent` gains the
 * inserted text). This is very likely an artifact of how Playwright's Firefox automation backend
 * (`juggler`) implements `insertText` internally, not a claim about how a real end user's actual Firefox
 * handles a real OS-level IME composition commit — but it means this one Playwright API can never be
 * trusted as cross-engine evidence for ADR-009's "beforeinput always blocks it" premise, and is the
 * closest thing this spec found to the exact risk ADR-009 named up front. ADR-009's own implementation
 * will need a manual, real-IME follow-up check in real Firefox to close that gap; nothing in this repo's
 * test infra (Playwright, local or in CI) can exercise a real composition sequence at all.
 */
import { expect, test, type Page } from '@playwright/test';

const EDITOR_HTML = `<!doctype html>
<html>
  <body>
    <div id="editor" contenteditable="true"></div>
    <script>
      window.__inputTypes = [];
      document.getElementById('editor').addEventListener('beforeinput', (event) => {
        window.__inputTypes.push(event.inputType);
        event.preventDefault();
      });
    </script>
  </body>
</html>`;

type CaretEdge = 'start' | 'end';

/** This package's own tsconfig has no "dom" lib (a Node server package) — every callback below runs in
 * the browser realm via `page.evaluate`/`addInitScript`, not in this file's own compilation target, so it
 * reaches the DOM through an untyped `globalThis` cast rather than bare `document`/`window` references
 * (same convention as `codemirror-csp-nonce.spec.ts`'s own doc comment explains). */
interface BrowserGlobal {
  __inputTypes: string[];
  document: {
    getElementById: (id: string) => { textContent: string | null; childElementCount: number; focus: () => void } | null;
    createRange: () => { selectNodeContents: (node: unknown) => void; collapse: (toStart: boolean) => void };
  };
  getSelection: () => { removeAllRanges: () => void; addRange: (range: unknown) => void } | null;
}

async function seedEditor(page: Page, text: string, caret: CaretEdge): Promise<void> {
  await page.evaluate(
    ({ text: seedText, caret: caretEdge }) => {
      const browserGlobal = globalThis as unknown as BrowserGlobal;
      const editor = browserGlobal.document.getElementById('editor');
      if (!editor) throw new Error('#editor not found');
      editor.textContent = seedText;
      browserGlobal.__inputTypes = [];
      editor.focus();
      const range = browserGlobal.document.createRange();
      range.selectNodeContents(editor);
      range.collapse(caretEdge === 'start');
      const selection = browserGlobal.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { text, caret },
  );
}

async function editorState(page: Page): Promise<{ textContent: string | null; inputTypes: string[] }> {
  return page.evaluate(() => {
    const browserGlobal = globalThis as unknown as BrowserGlobal;
    return {
      textContent: browserGlobal.document.getElementById('editor')?.textContent ?? null,
      inputTypes: browserGlobal.__inputTypes,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.setContent(EDITOR_HTML);
});

test('typing (insertText) is fully blocked, textContent never changes', async ({ page }) => {
  await seedEditor(page, 'seed', 'end');
  await page.keyboard.type('hello');
  const { textContent, inputTypes } = await editorState(page);
  expect(textContent).toBe('seed');
  expect(inputTypes.length).toBeGreaterThan(0);
  expect(inputTypes.every((type) => type === 'insertText')).toBe(true);
});

test('Backspace (deleteContentBackward) at a collapsed caret is fully blocked', async ({ page }) => {
  await seedEditor(page, 'seed', 'end');
  await page.keyboard.press('Backspace');
  const { textContent, inputTypes } = await editorState(page);
  expect(textContent).toBe('seed');
  expect(inputTypes).toEqual(['deleteContentBackward']);
});

test('Delete (deleteContentForward) at a collapsed caret is fully blocked', async ({ page }) => {
  await seedEditor(page, 'seed', 'start');
  await page.keyboard.press('Delete');
  const { textContent, inputTypes } = await editorState(page);
  expect(textContent).toBe('seed');
  expect(inputTypes).toEqual(['deleteContentForward']);
});

test('Enter (insertParagraph/insertLineBreak) is fully blocked, no <div>/<br> ever gets inserted', async ({ page }) => {
  await seedEditor(page, 'seed', 'end');
  await page.keyboard.press('Enter');
  const { textContent, inputTypes } = await editorState(page);
  expect(textContent).toBe('seed');
  expect(inputTypes.length).toBe(1);
  expect(['insertParagraph', 'insertLineBreak']).toContain(inputTypes[0]);
  const childElementCount = await page.evaluate(() => (globalThis as unknown as BrowserGlobal).document.getElementById('editor')?.childElementCount ?? -1);
  expect(childElementCount).toBe(0);
});

test('a selection replaced by typed text is fully blocked (select-all then type)', async ({ page }) => {
  await seedEditor(page, 'seed', 'end');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('replacement');
  const { textContent } = await editorState(page);
  expect(textContent).toBe('seed');
});

// See this file's own module doc comment: keyboard.insertText is the closest available approximation
// Playwright's public API offers for an IME composition's final commit (no keydown/keyup, a direct text
// insertion) — not a full compositionstart/compositionupdate/compositionend sequence, which Playwright
// cannot simulate. The two engines genuinely disagree here (a real finding, not a flaky test): Chromium
// respects preventDefault for it, Firefox's Playwright backend does not.
test('keyboard.insertText (closest available approximation of an IME composition commit)', async ({ page, browserName }) => {
  await seedEditor(page, 'seed', 'end');
  await page.keyboard.insertText('日本語');
  const { textContent, inputTypes } = await editorState(page);

  if (browserName === 'firefox') {
    // Known Playwright/Firefox (juggler) limitation, documented above: beforeinput does fire here (with
    // inputType 'insertCompositionText', not 'insertText' — Firefox's own read of what this API call
    // represents), but calling preventDefault() on it has no effect; the DOM mutates anyway.
    expect(textContent).toBe('seed日本語');
    expect(inputTypes).toEqual(['insertCompositionText']);
    return;
  }

  expect(textContent).toBe('seed');
  expect(inputTypes).toEqual(['insertText']);
});
