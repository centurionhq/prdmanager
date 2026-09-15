import type { ReactElement } from 'react';
import type { InboxItem } from '../../data';
import styles from './FeedbackRow.module.css';
import { formatRelativeDays } from './lib';
import { SourceIcon, sourceLabel } from './SourceIcon';

export interface TriagedRowProps {
  readonly item: InboxItem;
}

/** A read-only row for already-triaged feedback: no actions, just what it informed (WO-295). */
export function TriagedRow({ item }: TriagedRowProps): ReactElement {
  return (
    <div className={styles.row}>
      <div className={styles.summary}>
        <span className="id">{item.id}</span>
        <div className={styles.main}>
          <span className={styles.title}>{item.title}</span>
          <div className={styles.meta}>
            <SourceIcon source={item.source} />
            {sourceLabel(item.source)}
            {item.customer ? `, ${item.customer}` : null}
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span className="num">{formatRelativeDays(item.receivedAt)}</span>
          </div>
        </div>
        {item.links[0] ? (
          <span className={styles.informs}>
            Informa a <span className="id">{item.links[0]}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
