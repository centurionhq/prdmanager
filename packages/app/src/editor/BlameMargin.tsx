/**
 * Per-block author margin for the preview editor (SDD-014 §"Editor de vista previa", WO-381): same
 * `BlameResult` data and `describeAttribution`/`initial` label formatting as the Markdown tab's
 * `collab/blame-gutter.ts`, portaled into each block's own DOM node the same way `RemoteCursors.tsx` does
 * — a margin badge instead of a CodeMirror line-gutter marker.
 */
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BlameResult } from '@prdm/collab';
import { describeAttribution } from '../collab/blame-gutter.js';
import { blockBlameAttribution } from './block-blame.js';
import type { SourceBlock } from './source-map.js';
import styles from './BlameMargin.module.css';

interface BlockBlamePortalProps {
  block: SourceBlock;
  source: string;
  blame: BlameResult;
  container: HTMLElement | null;
}

function BlockBlamePortal({ block, source, blame, container }: BlockBlamePortalProps): ReactNode {
  const attribution = blockBlameAttribution(source, block, blame);
  if (!attribution) return null;

  const target = container?.querySelector(`[data-block-from="${block.from}"] [data-blame-slot]`);
  if (!target) return null;

  const { short, full } = describeAttribution(attribution);

  return createPortal(
    <span data-testid="blame-marker" className={styles.marker} aria-label={full} title={full}>
      {short}
    </span>,
    target,
  );
}

export interface BlameMarginProps {
  source: string;
  blocks: readonly SourceBlock[];
  blame: BlameResult | null;
  container: HTMLElement | null;
}

export function BlameMargin({ source, blocks, blame, container }: BlameMarginProps): ReactElement | null {
  if (!blame) return null;
  return (
    <>
      {blocks.map((block) => (
        <BlockBlamePortal key={block.from} block={block} source={source} blame={blame} container={container} />
      ))}
    </>
  );
}
