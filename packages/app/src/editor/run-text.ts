/**
 * Shared source-offset math for an {@link EditableRun}: how many raw markdown characters a run's leading
 * syntax (`**`, `*`, `~~`, `[`, `\`) takes up, and what plain text it actually displays once that syntax is
 * stripped. `PreviewEditor.tsx` uses {@link runDisplayText} to render; `dom-selection.ts` and the
 * composition-diff logic (WO-377/378) use {@link runPrefixLength} to map a display-text offset back to an
 * absolute position in the markdown source, since neither needs the run's *trailing* syntax length (a
 * link's `](href)` suffix varies with `href`) to do that.
 */
import type { EditableRun, SourceBlock } from './source-map.js';

const LINK_LABEL_PATTERN = /^\[(.*)\]\([^)]*\)$/s;

export function runDisplayText(source: string, run: EditableRun): string {
  const raw = source.slice(run.from, run.to);
  switch (run.kind) {
    case 'text':
      return raw;
    case 'softbreak':
      return '\n';
    case 'escape':
      return raw.slice(1);
    case 'emphasis':
      return raw.slice(1, -1);
    case 'strong':
    case 'strikethrough':
      return raw.slice(2, -2);
    case 'link':
      return LINK_LABEL_PATTERN.exec(raw)?.[1] ?? raw;
  }
}

export function runPrefixLength(kind: EditableRun['kind']): number {
  switch (kind) {
    case 'escape':
    case 'emphasis':
    case 'link':
      return 1;
    case 'strong':
    case 'strikethrough':
      return 2;
    case 'text':
    case 'softbreak':
      return 0;
  }
}

/**
 * Maps an offset into a block's *rendered* plain text (as `blockElement.textContent` gives it — the same
 * concatenation of {@link runDisplayText} across `block.runs`, in order) back to an absolute markdown
 * source offset. Used by the composition-diff reconciliation (WO-378), which only ever has plain rendered
 * text to compare before/after a composition, never a live DOM node to walk the way `dom-selection.ts` does.
 */
export function displayOffsetToSourceOffset(source: string, block: SourceBlock, displayOffset: number): number {
  let consumed = 0;
  for (const run of block.runs ?? []) {
    const text = runDisplayText(source, run);
    if (displayOffset <= consumed + text.length) {
      return run.from + runPrefixLength(run.kind) + (displayOffset - consumed);
    }
    consumed += text.length;
  }
  return block.to;
}
