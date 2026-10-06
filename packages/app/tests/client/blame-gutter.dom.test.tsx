/**
 * WO-161 — the gutter's own rendering/accessibility contract, exercised against a real `EditorView`
 * (no Yjs/HocuspocusProvider needed: the gutter only ever reads `blameField`, dispatched via
 * `setBlame`, entirely independent of the collab wiring).
 */
import { EditorState } from '@codemirror/state';
import { EditorView, getTooltip } from '@codemirror/view';
import { afterEach, describe, expect, test } from 'vitest';
import { blameGutterExtension, blameTooltipField, setBlame } from '../../src/collab/blame-gutter.js';
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
    const tooltip = view.dom.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toBe(marker.getAttribute('aria-label'));

    marker.click();
    expect(view.dom.querySelector('[role="tooltip"]')).toBeNull();
  });

  // WO-216: the old assertion above (tooltip exists in the DOM with the right text) passed even while
  // the tooltip was invisible on screen after scrolling — it never checked *where* the tooltip renders.
  // This test locks in the actual fix: the tooltip must be positioned via CodeMirror's own tooltip
  // system (anchored to the marker's live document position, `position: fixed`, mounted outside the
  // scrollable/clippable gutter container) instead of a hand-rolled absolutely-positioned span nested
  // inside the marker button, which is what produced the wrong-position bug in the first place.
  test('the open tooltip is positioned via CodeMirror\'s showTooltip mechanism, not nested inside the scrollable gutter', () => {
    view = makeView('line one');
    const blame: BlameResult = { lines: [{ line: 0, attribution: { actorKind: 'user', userId: 'ana', onBehalfOf: null, agentId: null, receivedAt: '2026-01-01T00:00:00.000Z' } }], fields: {} };
    view.dispatch({ effects: setBlame.of(blame) });

    const marker = view.dom.querySelector('.cm-blame-marker') as HTMLButtonElement;
    marker.click();

    const tooltipState = view.state.field(blameTooltipField);
    expect(tooltipState).not.toBeNull();

    // CodeMirror mounted this tooltip itself (proves we're using `showTooltip`, not manual DOM insertion).
    const tooltipView = getTooltip(view, tooltipState!);
    expect(tooltipView).not.toBeNull();
    const dom = tooltipView!.dom;

    // Mounted directly on the editor root, not nested inside the marker button or the scrollable gutter
    // — this is exactly what keeps it from being clipped/mispositioned by a scrolled ancestor.
    expect(dom.closest('.cm-blame-marker')).toBeNull();
    expect(dom.closest('.cm-blame-gutter')).toBeNull();
    expect(view.dom.contains(dom)).toBe(true);

    // CodeMirror's default (non-iOS) tooltip positioning is `fixed`, computed from the anchor's live
    // viewport coordinates rather than baked-in offsets relative to a scrolled ancestor.
    expect(dom.style.position).toBe('fixed');
    expect(dom.getAttribute('role')).toBe('tooltip');
    expect(dom.textContent).toBe(marker.getAttribute('aria-label'));
  });

  // WO-600: `@codemirror/view` sets `aria-hidden="true"` on `.cm-gutters` unconditionally (a reasonable
  // default when the only content is decorative line numbers) — but this gutter's markers are real,
  // focusable `<button>`s, and `aria-hidden` on an ancestor hides every focusable descendant from
  // assistive tech regardless of the descendant's own attributes (confirmed via axe-core's
  // `aria-hidden-focus` rule in `accessibility-screens.spec.ts`, intermittent because it only fires once
  // blame data has actually arrived and a marker exists).
  test('WO-600: .cm-gutters is never left aria-hidden once this extension is loaded, so its focusable markers stay reachable', () => {
    view = makeView('line one\nline two');
    // Even before any blame data arrives (no markers rendered yet), the container must already be fixed
    // -- CodeMirror sets the attribute at initial mount, before this extension gets a chance to react to
    // a `setBlame` dispatch.
    expect(view.dom.querySelector('.cm-gutters')?.getAttribute('aria-hidden')).not.toBe('true');

    const blame: BlameResult = { lines: [{ line: 0, attribution: { actorKind: 'user', userId: 'ana', onBehalfOf: null, agentId: null, receivedAt: '2026-01-01T00:00:00.000Z' } }], fields: {} };
    view.dispatch({ effects: setBlame.of(blame) });
    expect(view.dom.querySelectorAll('.cm-blame-marker')).toHaveLength(1);
    expect(view.dom.querySelector('.cm-gutters')?.getAttribute('aria-hidden')).not.toBe('true');
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
