/**
 * Remote collaborator cursor logic for the preview editor (SDD-014 §"Editor de vista previa", WO-380).
 * Reuses `y-codemirror.next`'s own awareness convention (`packages/app/src/collab/editor-extensions.ts`'s
 * `yCollab`): `awareness.setLocalStateField('cursor', { anchor, head })`, both `Y.RelativePosition` JSON —
 * the exact same field a collaborator on the Markdown (CodeMirror) tab already reads/writes, so a preview
 * user and a Markdown user always see each other regardless of which tab either one is on.
 *
 * Kept JSX-free (the rendering half lives in `RemoteCursors.tsx`) so `resolveRemoteCursorPositions` stays
 * importable from a plain `tsc --noEmit` project with no `--jsx` flag, like this app's Node unit-test suite.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { resolveActiveSelection } from './use-preview-selection.js';
import type { SourceBlock } from './source-map.js';

export interface RemoteCursorMarker {
  clientId: number;
  name: string;
  color: string;
  blockFrom: number;
}

const DEFAULT_NAME = 'Colaborador';
const DEFAULT_COLOR = 'var(--apagado)';

function findBlockForIndex(blocks: readonly SourceBlock[], index: number): SourceBlock | null {
  return blocks.find((block) => index >= block.from && index <= block.to) ?? null;
}

function readCursorHeadIndex(ydoc: Y.Doc, cursor: unknown): number | null {
  if (typeof cursor !== 'object' || cursor === null || !('head' in cursor)) return null;
  const relative = Y.createRelativePositionFromJSON((cursor as { head: unknown }).head);
  const absolute = Y.createAbsolutePositionFromRelativePosition(relative, ydoc);
  return absolute?.index ?? null;
}

/** Pure by design (WO-380): takes whatever `Awareness#getStates()` would return — a plain `Map` is enough
 * to exercise this in tests without a real `Awareness`/Hocuspocus instance. */
export function resolveRemoteCursorPositions(
  ydoc: Y.Doc,
  states: ReadonlyMap<number, Record<string, unknown>>,
  localClientId: number,
  blocks: readonly SourceBlock[],
): RemoteCursorMarker[] {
  const markers: RemoteCursorMarker[] = [];
  for (const [clientId, state] of states) {
    if (clientId === localClientId) continue;
    const headIndex = readCursorHeadIndex(ydoc, state.cursor);
    if (headIndex === null) continue;
    const block = findBlockForIndex(blocks, headIndex);
    if (!block) continue;
    const user = state.user as { name?: string; color?: string } | undefined;
    markers.push({ clientId, name: user?.name ?? DEFAULT_NAME, color: user?.color ?? DEFAULT_COLOR, blockFrom: block.from });
  }
  return markers;
}

export interface UseRemoteCursorsOptions {
  ytext: Y.Text;
  awareness: Awareness | null | undefined;
  containerRef: RefObject<HTMLElement | null>;
  blocks: readonly SourceBlock[];
}

/** Reads other collaborators' cursors on every awareness change, and publishes this editor's own
 * selection to `awareness` on every `selectionchange` — the same two-way contract the CodeMirror tab's
 * `yCollab` plugin already implements for the Markdown side. */
export function useRemoteCursors({ ytext, awareness, containerRef, blocks }: UseRemoteCursorsOptions): RemoteCursorMarker[] {
  const [markers, setMarkers] = useState<RemoteCursorMarker[]>([]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  useEffect(() => {
    const ydoc = ytext.doc;
    if (!awareness || !ydoc) {
      setMarkers([]);
      return;
    }
    const handleChange = (): void => setMarkers(resolveRemoteCursorPositions(ydoc, awareness.getStates(), awareness.clientID, blocksRef.current));
    awareness.on('change', handleChange);
    handleChange();
    return () => awareness.off('change', handleChange);
  }, [awareness, ytext]);

  useEffect(() => {
    if (!awareness) return undefined;

    const handleSelectionChange = (): void => {
      const container = containerRef.current;
      const selection = container ? resolveActiveSelection(container, blocksRef.current) : null;
      if (!selection) return;
      const from = selection.block.contentFrom + selection.from;
      const to = selection.block.contentFrom + selection.to;
      awareness.setLocalStateField('cursor', {
        anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from)),
        head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to)),
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [awareness, ytext, containerRef]);

  return markers;
}
