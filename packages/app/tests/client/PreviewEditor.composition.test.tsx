/**
 * WO-378 — IME composition reconciled as one diff-based splice at `compositionend` (never from the noisy
 * intermediate `beforeinput` events), paste as escaped plain text only (never clipboard HTML), drag-and-drop
 * disabled unconditionally, and a `MutationObserver` that reverts any DOM mutation this component didn't
 * itself cause (e.g. a foreign `appendChild`) while leaving its own render-driven mutations and in-progress
 * IME composition alone.
 */
import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { PreviewEditor } from '../../src/editor/PreviewEditor.js';

function docWithBody(body: string): Y.Text {
  const ydoc = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('body');
  ytext.insert(0, body);
  return ytext;
}

function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) throw new Error('expected a Selection object in jsdom');
  selection.removeAllRanges();
  selection.addRange(range);
}

function firstParagraphTextNode(): Text {
  const paragraph = document.querySelector('p[data-block-from]');
  if (!paragraph?.firstChild) throw new Error('expected a rendered paragraph with a text node');
  return paragraph.firstChild as Text;
}

function makePasteEvent(plainText: string, html: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? plainText : html) },
  });
  return event;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PreviewEditor composition handling (WO-378)', () => {
  it('reconciles a composition sequence into a single splice at compositionend', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();

    act(() => {
      textNode.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
    });
    // Intermediate beforeinput noise during composition must never be applied on its own.
    act(() => {
      textNode.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertCompositionText', data: 'ó' }));
    });
    act(() => {
      textNode.data = 'helló world';
    });
    act(() => {
      textNode.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: 'ó' }));
    });

    expect(ytext.toString()).toBe('helló world');
  });
});

describe('PreviewEditor paste handling (WO-378)', () => {
  it('inserts only the escaped plain-text clipboard payload, never HTML', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();
    placeCaret(textNode, 5);

    act(() => {
      textNode.dispatchEvent(makePasteEvent('*bold*', '<b>*bold*</b><script>alert(1)</script>'));
    });

    expect(ytext.toString()).toBe('hello\\*bold\\* world');
    expect(ytext.toString()).not.toContain('<script>');
    expect(ytext.toString()).not.toContain('<b>');
  });

  it('prevents the paste event default action', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();
    placeCaret(textNode, 5);

    const event = makePasteEvent('x', '<b>x</b>');
    act(() => {
      textNode.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('PreviewEditor drop handling (WO-378)', () => {
  it('always prevents the default drop action', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const container = document.querySelector('[data-testid="preview-editor"]')!;

    const event = new Event('drop', { bubbles: true, cancelable: true });
    act(() => {
      container.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('PreviewEditor MutationObserver guard (WO-378)', () => {
  it('reverts a foreign DOM mutation not caused by its own render cycle', async () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const container = document.querySelector('[data-testid="preview-editor"]')!;
    const childCountBefore = container.childNodes.length;

    const foreign = document.createElement('span');
    foreign.textContent = 'injected';
    container.appendChild(foreign);

    await flushMicrotasks();

    expect(container.contains(foreign)).toBe(false);
    expect(container.childNodes.length).toBe(childCountBefore);
  });
});
