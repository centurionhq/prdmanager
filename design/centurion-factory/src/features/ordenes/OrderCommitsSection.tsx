/** OrderDrawer's "Commits" section: the commits linked to this order, or an empty note. */
import type { ReactElement } from 'react';
import type { Commit } from '../../data';
import { formatDateEs } from './format';
import styles from './OrderDrawer.module.css';

export interface OrderCommitsSectionProps {
  readonly commits: readonly Commit[];
}

export function OrderCommitsSection({ commits }: OrderCommitsSectionProps): ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Commits</h3>
      {commits.length > 0 ? (
        <ul className={styles.commits}>
          {commits.map((commit) => (
            <li key={commit.sha} className={styles.commitRow}>
              <span className="id">{commit.sha}</span>
              <span>{commit.subject}</span>
              <span className={styles.commitMeta}>
                <span className="id">{commit.author}</span> · {formatDateEs(commit.date)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noCommits}>Todavía no hay commits para esta orden.</p>
      )}
    </section>
  );
}
