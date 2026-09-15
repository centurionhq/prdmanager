import type { ReactElement } from 'react';
import type { InboxItem } from '../../data';
import styles from './FeedbackRow.module.css';
import { formatRelativeDays } from './lib';
import { SourceIcon, sourceLabel } from './SourceIcon';

export interface ArtifactRowProps {
  readonly item: InboxItem;
}

/** A read-only row for an artifact: context material, not something that gets triaged (WO-295). */
export function ArtifactRow({ item }: ArtifactRowProps): ReactElement {
  return (
    <div className={styles.row}>
      <div className={styles.summary}>
        <span className="id">{item.id}</span>
        <div className={styles.main}>
          <span className={styles.title}>{item.title}</span>
          <div className={styles.meta}>
            <SourceIcon source={item.source} />
            {sourceLabel(item.source)}
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span className="num">{formatRelativeDays(item.receivedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
