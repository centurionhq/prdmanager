/**
 * Renders each `RemoteCursorMarker` (`remote-cursors.ts`) as a small labeled tag portaled directly into
 * its target block's own DOM node (matched by `data-block-from`, the same attribute `PreviewEditor.tsx`
 * already renders on every block) — so the marker always tracks the block visually, without this
 * component needing to duplicate `PreviewEditor`'s own block-rendering logic.
 *
 * `container` is `null` until `PreviewEditor` attaches its ref during commit (refs can never be read
 * during the render that creates them), then becomes the live element for the rest of this tree's
 * lifetime — `PreviewEditor` re-renders once, from its own container-attaching callback ref, rather than
 * every portal forcing its own extra render.
 */
import { type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RemoteCursorMarker } from './remote-cursors.js';
import styles from './RemoteCursors.module.css';

interface BlockCursorPortalProps {
  marker: RemoteCursorMarker;
  container: HTMLElement | null;
}

function BlockCursorPortal({ marker, container }: BlockCursorPortalProps): ReactNode {
  const target = container?.querySelector(`[data-block-from="${marker.blockFrom}"] [data-cursor-slot]`);
  if (!target) return null;
  return createPortal(
    // WO-387 (accessibility gate): this badge sits inside the block's own text flow (`data-cursor-slot`,
    // a sibling of the block's real runs) and the editable ancestor is announced as a `role="textbox"` —
    // a screen reader reading that "value" straight through would otherwise read a collaborator's name
    // stitched into the middle of a sentence, and it would re-fire on every keystroke as the marker's
    // position moves. Presence has no informational value worth that disruption (unlike `BlameMargin`'s
    // stable, deliberately-labeled attribution), so it's `aria-hidden` — purely a sighted-user visual cue.
    <span
      data-testid="remote-cursor"
      data-block-from={marker.blockFrom}
      data-client-id={marker.clientId}
      className={styles.marker}
      style={{ color: marker.color, borderColor: marker.color }}
      aria-hidden="true"
    >
      {marker.name}
    </span>,
    target,
  );
}

export interface RemoteCursorsProps {
  markers: readonly RemoteCursorMarker[];
  container: HTMLElement | null;
}

export function RemoteCursors({ markers, container }: RemoteCursorsProps): ReactElement {
  return (
    <>
      {markers.map((marker) => (
        <BlockCursorPortal key={marker.clientId} marker={marker} container={container} />
      ))}
    </>
  );
}
