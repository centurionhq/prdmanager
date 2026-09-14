/**
 * WO-161 — the gutter's own rendering/accessibility contract, exercised against a real `EditorView`
 * (no Yjs/HocuspocusProvider needed: the gutter only ever reads `blameField`, dispatched via
 * `setBlame`, entirely independent of the collab wiring).
 */
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, test } from 'vitest';
import { blameGutterExtension, setBlame } from '../../src/collab/blame-gutter.js';
import type { BlameResult } from '@prdm/collab';

function makeView(doc: string): EditorView {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new EditorView({ state: EditorState.create({ doc, extensions: [blameGutterExtension] }), parent: container });
}

describe('blame gutter (DOM)', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  test('renders no markers before any blame data has been dispatched', () => {
    view = makeView('line one\nline two');
    expect(view.dom.querySelectorAll('.cm-blame-marker')).toHaveLength(0);
  });

  test('renders one accessible marker per attributed line, with a real aria-label', () => {
    view = makeView('line one\nline two');
    const blame: BlameResult = {
      lines: [
        { line: 0, attribution: { actorKind: 'user', userId: 'ana', onBehalfOf: null, agentId: null, receivedAt: '2026-01-01T00:00:00.000Z' } },
        { line: 1, attribution: { actorKind: 'agent', userId: null, onBehalfOf: 'erin', agentId: 'agent:deepseek', receivedAt: '2026-01-01T00:00:00.000Z' } },
      ],
      fields: {},
    };
    view.dispatch({ effects: setBlame.of(blame) });

    const markers = Array.from(view.dom.querySelectorAll('.cm-blame-marker'));
    expect(markers).toHaveLength(2);
    expect(markers[0]?.tagName).toBe('BUTTON'); // real <button> — free keyboard focus/activation
    expect(markers[0]?.getAttribute('aria-label')).toContain('ana');
    expect(markers[1]?.getAttribute('aria-label')).toMatch(/^Agente \(aceptado por erin\)/);
  });

  test('a line with no attribution gets no marker at all', () => {
    view = makeView('line one\nline two');
    const blame: BlameResult = { lines: [{ line: 0, attribution: null }, { line: 1, attribution: null }], fields: {} };
    view.dispatch({ effects: setBlame.of(blame) });
    expect(view.dom.querySelectorAll('.cm-blame-marker')).toHaveLength(0);
  });

  test('clicking a marker opens a tooltip with the same info as the aria-label; clicking again closes it', () => {
    view = makeView('line one');
    const blame: BlameResult = { lines: [{ line: 0, attribution: { actorKind: 'user', userId: 'ana', onBehalfOf: null, agentId: null, receivedAt: '2026-01-01T00:00:00.000Z' } }], fields: {} };
    view.dispatch({ effects: setBlame.of(blame) });

    const marker = view.dom.querySelector('.cm-blame-marker') as HTMLButtonElement;
    expect(marker.querySelector('[role="tooltip"]')).toBeNull();

    marker.click();
    const tooltip = marker.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toBe(marker.getAttribute('aria-label'));

    marker.click();
    expect(marker.querySelector('[role="tooltip"]')).toBeNull();
  });

  test('a fresh setBlame dispatch (e.g. after a blame:stale refetch) replaces the previous markers', () => {
    view = makeView('line one');
    const blameFor = (userId: string, receivedAt: string): BlameResult => ({
      lines: [{ line: 0, attribution: { actorKind: 'user', userId, onBehalfOf: null, agentId: null, receivedAt } }],
      fields: {},
    });
    view.dispatch({ effects: setBlame.of(blameFor('ana', '2026-01-01T00:00:00.000Z')) });
    expect(view.dom.querySelector('.cm-blame-marker')?.getAttribute('aria-label')).toContain('ana');

    view.dispatch({ effects: setBlame.of(blameFor('bob', '2026-01-01T00:01:00.000Z')) });
    expect(view.dom.querySelector('.cm-blame-marker')?.getAttribute('aria-label')).toContain('bob');
  });
});
