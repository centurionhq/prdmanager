/**
 * WO-377 — `beforeinput` always prevented and translated into a single `applySplice` call, for the three
 * input types the WO calls out explicitly: simple insertion, backward delete, forward delete. Also confirms
 * the DOM caret is restored at the right position after the resulting re-render. jsdom never dispatches
 * `beforeinput` on its own for these actions, so every case dispatches a real `InputEvent` by hand (as the
 * WO's own instructions anticipate).
 */
import { act, render, screen } from '@testing-library/react';
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

function dispatchBeforeInput(target: Node, inputType: string, data: string | null = null): InputEvent {
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType, data });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function firstParagraphTextNode(): Text {
  const paragraph = document.querySelector('p[data-block-from]');
  if (!paragraph?.firstChild) throw new Error('expected a rendered paragraph with a text node');
  return paragraph.firstChild as Text;
}

describe('PreviewEditor beforeinput handling (WO-377)', () => {
  it('translates insertText at a collapsed caret into a single insertion splice', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();

    placeCaret(textNode, 5);
    dispatchBeforeInput(textNode, 'insertText', ',');

    expect(ytext.toString()).toBe('hello, world');
  });

  it('restores the caret right after the inserted text once the DOM re-renders', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();

    placeCaret(textNode, 5);
    dispatchBeforeInput(textNode, 'insertText', ',');

    const selection = window.getSelection()!;
    const restoredNode = firstParagraphTextNode();
    expect(selection.anchorNode).toBe(restoredNode);
    expect(selection.anchorOffset).toBe(6);
  });

  it('translates deleteContentBackward into a single-character deletion before the caret', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();

    placeCaret(textNode, 5);
    dispatchBeforeInput(textNode, 'deleteContentBackward');

    expect(ytext.toString()).toBe('hell world');
  });

  it('translates deleteContentForward into a single-character deletion after the caret', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();

    placeCaret(textNode, 5);
    dispatchBeforeInput(textNode, 'deleteContentForward');

    expect(ytext.toString()).toBe('helloworld');
  });

  it('never lets the browser apply its own default action (preventDefault is always called)', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    const textNode = firstParagraphTextNode();
    placeCaret(textNode, 5);

    const event = dispatchBeforeInput(textNode, 'insertText', 'x');

    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing when readOnly is true', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} readOnly />);
    const textNode = firstParagraphTextNode();

    placeCaret(textNode, 5);
    dispatchBeforeInput(textNode, 'insertText', 'x');

    expect(ytext.toString()).toBe('hello world');
  });

  it('joins the current block into the previous one when deleting backward at the very start of its content', () => {
    const ytext = docWithBody(['first', '', 'second'].join('\n'));
    render(<PreviewEditor ytext={ytext} />);
    const paragraphs = document.querySelectorAll('p[data-block-from]');
    const secondParagraphText = paragraphs[1]!.firstChild as Text;

    placeCaret(secondParagraphText, 0);
    dispatchBeforeInput(secondParagraphText, 'deleteContentBackward');

    expect(ytext.toString()).toBe('first second');
  });
});
