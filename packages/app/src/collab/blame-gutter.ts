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
 */
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
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
    private readonly short: string,
    private readonly full: string,
  ) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof BlameMarker && other.short === this.short && other.full === this.full;
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
      const existing = button.querySelector('[role="tooltip"]');
      if (existing) {
        existing.remove();
        return;
      }
      const tooltip = document.createElement('span');
      tooltip.setAttribute('role', 'tooltip');
      tooltip.className = 'cm-blame-tooltip';
      tooltip.textContent = this.full;
      button.appendChild(tooltip);
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
    return new BlameMarker(short, full);
  },
  lineMarkerChange: (update) => update.state.field(blameField) !== update.startState.field(blameField),
});

export const blameGutterExtension = [blameField, blameGutter, EditorView.baseTheme({ '.cm-blame-marker': { cursor: 'pointer' } })];
