import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../../components';
import type { InboxItem } from '../../data';
import styles from './FeedbackRow.module.css';
import { daysSince, formatRelativeDays, formatScore, isOverdue, rankCandidates } from './lib';
import { SourceIcon, sourceLabel } from './SourceIcon';

export interface FeedbackRowProps {
  readonly item: InboxItem;
  readonly expanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onLink: () => void;
  readonly onCreateFeatureRequest: () => void;
}

/** One untriaged feedback item: summary line, actions and an expandable quote + candidates. */
export function FeedbackRow({ item, expanded, onToggleExpand, onLink, onCreateFeatureRequest }: FeedbackRowProps): ReactElement {
  const overdue = isOverdue(item.receivedAt);
  const candidates = rankCandidates(item);

  return (
    <div className={styles.row}>
      <div className={styles.summary}>
        <span className="id">{item.id}</span>
        <div className={styles.main}>
          <button type="button" className={styles.titleButton} onClick={onToggleExpand} aria-expanded={expanded}>
            {expanded ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
            <span className={styles.title}>{item.title}</span>
          </button>
          <div className={styles.meta}>
            <SourceIcon source={item.source} />
            {sourceLabel(item.source)}
            {item.customer ? `, ${item.customer}` : null}
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span className="num">{formatRelativeDays(item.receivedAt)}</span>
          </div>
          <div className={[styles.overdue, overdue ? styles.overdueActive : null].filter(Boolean).join(' ')}>
            {overdue ? <span className={styles.andonDot} aria-hidden="true" /> : null}
            Lleva {daysLabel(item.receivedAt)} sin triar
          </div>
        </div>
        <div className={styles.actions}>
          <Button type="button" variant="primary" size="sm" className={styles.actionButton} onClick={onLink}>
            Enlazar a feature
          </Button>
          <Button type="button" variant="secondary" size="sm" className={styles.actionButton} onClick={onCreateFeatureRequest}>
            Crear feature request
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className={styles.detail}>
          <blockquote className={styles.quote}>{item.body}</blockquote>
          {candidates.length > 0 ? (
            <div className={styles.candidates}>
              <h3 className={styles.candidatesTitle}>Candidatas</h3>
              {candidates.map((candidate) => (
                <div key={candidate.featureId} className={styles.candidateRow}>
                  <span className="id">{candidate.featureId}</span>
                  <div className={styles.candidateText}>
                    <span className={styles.candidateReason}>
                      {candidate.reason}
                      {candidate.isBestMatch ? <span className={styles.bestMatch}> Mejor coincidencia</span> : null}
                    </span>
                  </div>
                  <div className={styles.scoreBar}>
                    <span className={styles.scoreTrack}>
                      <span
                        className={[styles.scoreFill, candidate.isBestMatch ? styles.scoreFillBest : null].filter(Boolean).join(' ')}
                        style={{ width: `${Math.round(candidate.score * 100)}%` }}
                      />
                    </span>
                    <span className={['num', styles.scoreValue].join(' ')}>{formatScore(candidate.score)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.noCandidates}>Todavía no hay candidatas sugeridas para este feedback.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function daysLabel(receivedAt: string): string {
  const days = daysSince(receivedAt);
  return `${days} ${days === 1 ? 'día' : 'días'}`;
}
