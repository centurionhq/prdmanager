/**
 * WO-384 — SDD-014's performance budget: a realistic ~200 KB markdown document parses/classifies in a
 * bounded time, and applying ONE incremental edit (a single keystroke) costs nowhere near a full
 * re-parse of the document, because `y-binding.ts`'s `applySplice` primes `parse-cache.ts` with an
 * incremental (fragment-reusing) `TreeFragment` re-parse instead of every call site re-parsing the whole
 * document from scratch (see `parse-cache.ts` for the mechanism).
 *
 * Thresholds are deliberately generous multiples of what this suite actually measures on a dev machine, not
 * tight numbers copied from a single local run: this project's CI runner is a much weaker 2vCPU box (see
 * `project_ci_timing_flakiness` prior art), and this is a jsdom + React test, not a bare parse benchmark, so
 * it also carries DOM/act() overhead a production browser keystroke wouldn't. The important, load-bearing
 * assertion is the `markdownParser.parse` call-count spy below: it proves the *architectural* fix (one
 * incremental parse per edit, not a full re-parse per call site) deterministically, with zero wall-clock
 * flakiness. The `performance.now()` assertions back it up with a real, generous ceiling.
 */
import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { PreviewEditor } from '../../src/editor/PreviewEditor.js';
import { classifyDocument, markdownParser } from '../../src/editor/source-map.js';

const TARGET_BYTES = 200 * 1024;

/** Realistic mixed content (SDD-014's own wording): headings, prose paragraphs with inline marks and
 * links, bullet/ordered lists, and task items — not one giant block, so classification actually exercises
 * every `BlockKind` branch across hundreds of blocks the way a real Documento body would. */
function buildLargeDocument(targetBytes: number): string {
  const parts: string[] = [];
  let bytes = 0;
  let i = 0;
  while (bytes < targetBytes) {
    const chunk = nextChunk(i);
    parts.push(chunk);
    bytes += chunk.length;
    i++;
  }
  return parts.join('\n');
}

function nextChunk(index: number): string {
  switch (index % 6) {
    case 0:
      return `# Sección ${index}\n`;
    case 1:
      return `Este es el párrafo número ${index} con **texto en negrita**, *énfasis*, y un [enlace](https://example.com/${index}) dentro de la oración.\n`;
    case 2:
      return `## Subsección ${index}\n`;
    case 3:
      return `- elemento con viñeta ${index}, con algo más de texto descriptivo para simular contenido real\n`;
    case 4:
      return `1. elemento numerado ${index}, también con texto descriptivo adicional para el mismo fin\n`;
    default:
      return `- [ ] tarea pendiente ${index} que hay que resolver eventualmente\n`;
  }
}

function docWithBody(body: string): Y.Text {
  const ydoc = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('body');
  ytext.insert(0, body);
  return ytext;
}

function dispatchBeforeInput(target: Node, inputType: string, data: string | null = null): void {
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType, data });
  target.dispatchEvent(event);
}

/** The last `## Subsección N` heading — plain text with no inline marks, so its single text-node child's
 * end is exactly the block's own content end, matching the simple single-run case the rest of this suite's
 * `PreviewEditor.beforeinput.test.tsx` already exercises. Any other block would work just as well for the
 * perf budget itself; this one just makes the resulting assertions unambiguous. */
function lastSubsectionHeading(): HTMLElement {
  const headings = document.querySelectorAll<HTMLElement>('h2[data-block-from]');
  const heading = headings[headings.length - 1];
  if (!heading?.firstChild) throw new Error('expected at least one rendered "## Subsección" heading with a text node');
  return heading;
}

function placeCaretAtEnd(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) throw new Error('expected a Selection object in jsdom');
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('PreviewEditor performance budget (WO-384, SDD-014)', () => {
  const source = buildLargeDocument(TARGET_BYTES);

  it('is a realistic ~200 KB fixture with hundreds of mixed blocks', () => {
    const byteLength = Buffer.byteLength(source, 'utf8');
    expect(byteLength).toBeGreaterThanOrEqual(TARGET_BYTES);
    expect(byteLength).toBeLessThan(TARGET_BYTES * 1.1);

    const blocks = classifyDocument(source);
    expect(blocks.length).toBeGreaterThan(400);
  });

  it('parses and classifies the full ~200 KB document within a generous, CI-safe budget', () => {
    // Generous on purpose (see module doc comment): a bare, non-cached `@lezer/markdown` parse of this
    // fixture measures ~25-45ms on ordinary dev hardware; 400ms leaves ~10x headroom for a slow CI runner
    // while still catching an order-of-magnitude regression (e.g. an accidental quadratic-time classifier).
    const start = performance.now();
    const blocks = classifyDocument(source);
    const duration = performance.now() - start;

    expect(blocks.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(400);
  });

  it('applies one incremental edit via exactly one incremental parse, not a full document re-parse', () => {
    const ytext = docWithBody(source);
    render(<PreviewEditor ytext={ytext} />);

    // Mounting already primed parse-cache.ts's cache with one full parse; only edits after this point are
    // under test.
    const parseSpy = vi.spyOn(markdownParser, 'parse');

    const target = lastSubsectionHeading();
    const before = target.textContent;
    placeCaretAtEnd(target.firstChild!);

    act(() => {
      dispatchBeforeInput(target.firstChild!, 'insertText', '!');
    });

    expect(ytext.toString().length).toBe(source.length + 1);
    expect(target.textContent).toBe(`${before}!`);
    // Exactly one lezer parse for the whole edit: `usePreviewInput`'s pre-edit classification and the
    // post-edit render + cursor-restore classification all hit `parse-cache.ts`'s cache instead of calling
    // `markdownParser.parse` again — this is what makes the edit cheap regardless of document size.
    expect(parseSpy).toHaveBeenCalledTimes(1);

    parseSpy.mockRestore();
  });

  it('applies one incremental edit and re-renders in well under a generous per-keystroke budget', () => {
    const ytext = docWithBody(source);
    render(<PreviewEditor ytext={ytext} />);

    const target = lastSubsectionHeading();
    const before = target.textContent;
    placeCaretAtEnd(target.firstChild!);

    const start = performance.now();
    act(() => {
      dispatchBeforeInput(target.firstChild!, 'insertText', '!');
    });
    const duration = performance.now() - start;

    expect(target.textContent).toBe(`${before}!`);
    // SDD-014's production target is "well under 16ms" on a real browser keystroke. This jsdom + React
    // + act() test carries overhead a browser frame doesn't, and CI hardware is markedly slower than a dev
    // machine — a 100ms ceiling measured 105ms on the project's actual shared-runner CI (a real, observed
    // overshoot, not a hypothetical one), so 250ms is the generous ceiling here — still comfortably tight
    // enough to fail hard if the fix regressed back to a full ~20-25ms-plus document re-parse happening two
    // or three times per keystroke (60ms+ alone, before any CI slowdown). The call-count spy in the
    // previous test is still the real, zero-flakiness regression guard; this one is a secondary backstop.
    expect(duration).toBeLessThan(250);
  });
});
