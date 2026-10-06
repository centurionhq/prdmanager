/**
 * Accessible, keyboard-focusable blame gutter (SDD-008 §"Editor"): one compact author indicator per
 * line, fed by a `StateField` the host component (`CollabEditor.tsx`) updates via {@link setBlame}
 * whenever fresh blame data arrives (initial fetch, and every `blame:stale` refetch, WO-154/161) — the
 * gutter itself never fetches anything, it only ever renders whatever `BlameResult` it's given.
 *
 * Each marker is a real `<button>` (native keyboard focus/activation for free — Tab reaches it, Enter and
 * Space both fire `click` on a `<button>` per the HTML spec, no custom key handling needed) with an
 * `aria-label` carrying the exact same information the visual tooltip shows, not just a `title` attribute
 * a screen reader would silently skip on focus.
 *
 * WO-216: the popup tooltip is rendered through CodeMirror's own `showTooltip` facet rather than a
 * hand-rolled `position: absolute` span appended inside the marker button. The gutter lives inside
 * `.cm-scroller` (a scrolling ancestor), and a tooltip absolutely positioned relative to the marker
 * ended up with its `getBoundingClientRect()` hundreds of pixels away from the marker's actual on-screen
 * position once the editor was scrolled. `showTooltip` mounts its DOM directly on `.cm-editor` with
 * `position: fixed` (recomputed from the anchor's live coordinates on every scroll/resize), which sidesteps
 * that class of bug entirely instead of patching the positioning math by hand.
 */
import { EditorView, GutterMarker, gutter, showTooltip, ViewPlugin } from '@codemirror/view';
import type { Tooltip } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { BlameResult } from '@prdm/collab';

export const setBlame = StateEffect.define<BlameResult | null>();

export const blameField = StateField.define<BlameResult | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setBlame)) return effect.value;
    return value;
  },
});

/** WO-216: `null` closes the tooltip; a line number (0-indexed, matching `BlameResult`) opens it for
 * that line. Dispatched by the marker's click handler, never by anything outside this module. */
export const setBlameTooltip = StateEffect.define<number | null>();

export const blameTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setBlameTooltip)) continue;
      if (effect.value === null) return null;
      const blame = tr.state.field(blameField);
      const attribution = blame?.lines[effect.value]?.attribution;
      if (!attribution) return null;
      const { full } = describeAttribution(attribution);
      return {
        pos: tr.state.doc.line(effect.value + 1).from,
        above: false,
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-blame-tooltip';
          dom.setAttribute('role', 'tooltip');
          dom.textContent = full;
          return { dom };
        },
      };
    }
    if (tooltip && tr.docChanged) return { ...tooltip, pos: tr.changes.mapPos(tooltip.pos) };
    return tooltip;
  },
  provide: (field) => showTooltip.from(field),
});

export function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
}

export function relativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 1) return 'ahora';
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  return `hace ${diffDays} d`;
}

/** SDD-008 §"Autoría por línea no falsificable": "El agente se muestra como 'Agente (aceptado por
 * Ana)'." — `onBehalfOf` here is always the accepting user's id, not a display name (the gutter has no
 * user-id -> name lookup of its own); good enough for the accessible label until a later WO wires a
 * shared user-directory lookup, and still far more useful than nothing. */
export function describeAttribution(attribution: NonNullable<BlameResult['lines'][number]['attribution']>): { short: string; full: string } {
  const who = attribution.userId ?? attribution.onBehalfOf ?? attribution.agentId ?? 'desconocido';
  const when = relativeDate(attribution.receivedAt);
  if (attribution.actorKind === 'agent') {
    const acceptedBy = attribution.onBehalfOf ?? 'desconocido';
    return { short: initial(attribution.agentId ?? 'A'), full: `Agente (aceptado por ${acceptedBy}) · ${when}` };
  }
  if (attribution.actorKind === 'system') {
    const onBehalfOf = attribution.onBehalfOf;
    return { short: 'S', full: onBehalfOf ? `Sistema (en nombre de ${onBehalfOf}) · ${when}` : `Sistema · ${when}` };
  }
  return { short: initial(who), full: `${who} · ${when}` };
}

class BlameMarker extends GutterMarker {
  constructor(
    private readonly view: EditorView,
    private readonly lineNumber: number,
    private readonly short: string,
    private readonly full: string,
  ) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof BlameMarker && other.lineNumber === this.lineNumber && other.short === this.short && other.full === this.full;
  }

  override toDOM(): Node {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-blame-marker';
    button.textContent = this.short;
    button.setAttribute('aria-label', this.full);
    button.title = this.full;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const current = this.view.state.field(blameTooltipField);
      const linePos = this.view.state.doc.line(this.lineNumber + 1).from;
      const isOpenForThisLine = current !== null && current.pos === linePos;
      this.view.dispatch({ effects: setBlameTooltip.of(isOpenForThisLine ? null : this.lineNumber) });
    });
    return button;
  }
}

export const blameGutter = gutter({
  class: 'cm-blame-gutter',
  lineMarker(view, line) {
    const blame = view.state.field(blameField);
    if (!blame) return null;
    const lineNumber = view.state.doc.lineAt(line.from).number - 1; // 0-indexed, matching BlameResult
    const attribution = blame.lines[lineNumber]?.attribution;
    if (!attribution) return null;
    const { short, full } = describeAttribution(attribution);
    return new BlameMarker(view, lineNumber, short, full);
  },
  lineMarkerChange: (update) => update.state.field(blameField) !== update.startState.field(blameField),
});

/** WO-600: `@codemirror/view` sets `aria-hidden="true"` on `.cm-gutters` unconditionally, a reasonable
 * default when a gutter's only content is decorative line numbers -- but `aria-hidden` on an ancestor
 * hides every focusable descendant from assistive tech regardless of that descendant's own attributes
 * (confirmed via axe-core's `aria-hidden-focus` rule), and this extension's markers are real, focusable
 * `<button>`s. There's no CodeMirror facet to opt a specific gutter out of the parent's `aria-hidden`.
 *
 * A `ViewPlugin` `constructor`/`update` pair (this WO's first attempt) fixed it in isolation
 * (`blame-gutter.dom.test.tsx`'s own minimal `EditorView`) but still intermittently failed inside the
 * real app (`accessibility-screens.spec.ts`): `.cm-gutters` is built by `@codemirror/view`'s own internal
 * gutter machinery, whose exact ordering relative to a user-supplied plugin's `constructor` isn't a
 * documented contract this extension controls -- with the app's fuller extension set (`yCollab`,
 * `markdown()`, `commentHighlightExtension`, ...) that ordering evidently isn't always "gutters DOM exists
 * before this plugin's constructor runs" the way it is in a minimal test view. A `MutationObserver` on
 * `view.dom` (which always exists synchronously in the constructor, unlike `.cm-gutters`) sidesteps the
 * ordering question entirely: it fires the instant CodeMirror sets the attribute on `.cm-gutters`
 * *whenever* that happens, first render or not, and also catches the element being replaced outright. */
const gutterAccessibilityFix = ViewPlugin.fromClass(
  class {
    private readonly observer: MutationObserver;

    constructor(view: EditorView) {
      this.fix(view);
      this.observer = new MutationObserver(() => this.fix(view));
      this.observer.observe(view.dom, { attributes: true, attributeFilter: ['aria-hidden'], subtree: true, childList: true });
    }
    update(update: { view: EditorView }): void {
      this.fix(update.view);
    }
    destroy(): void {
      this.observer.disconnect();
    }
    private fix(view: EditorView): void {
      const gutters = view.dom.querySelector('.cm-gutters');
      if (gutters?.getAttribute('aria-hidden') === 'true') gutters.removeAttribute('aria-hidden');
    }
  },
);

export const blameGutterExtension = [
  blameField,
  blameTooltipField,
  blameGutter,
  gutterAccessibilityFix,
  EditorView.baseTheme({ '.cm-blame-marker': { cursor: 'pointer' } }),
];
