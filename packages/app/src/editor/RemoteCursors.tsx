/**
 * Renders each `RemoteCursorMarker` (`remote-cursors.ts`) as a small labeled tag portaled directly into
 * its target block's own DOM node (matched by `data-block-from`, the same attribute `PreviewEditor.tsx`
 * already renders on every block) — so the marker always tracks the block visually, without this
 * component needing to duplicate `PreviewEditor`'s own block-rendering logic.
 */
import { type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { RemoteCursorMarker } from './remote-cursors.js';
import styles from './RemoteCursors.module.css';

interface BlockCursorPortalProps {
  marker: RemoteCursorMarker;
  containerRef: RefObject<HTMLElement | null>;
}

function BlockCursorPortal({ marker, containerRef }: BlockCursorPortalProps): ReactNode {
  const container = containerRef.current;
  const target = container?.querySelector(`[data-block-from="${marker.blockFrom}"]`);
  if (!target) return null;
  return createPortal(
    <span
      data-testid="remote-cursor"
      data-block-from={marker.blockFrom}
      data-client-id={marker.clientId}
      className={styles.marker}
      style={{ color: marker.color, borderColor: marker.color }}
    >
      {marker.name}
    </span>,
    target,
  );
}

export interface RemoteCursorsProps {
  markers: readonly RemoteCursorMarker[];
  containerRef: RefObject<HTMLElement | null>;
}

export function RemoteCursors({ markers, containerRef }: RemoteCursorsProps): ReactElement {
  return (
    <>
      {markers.map((marker) => (
        <BlockCursorPortal key={marker.clientId} marker={marker} containerRef={containerRef} />
      ))}
    </>
  );
}
