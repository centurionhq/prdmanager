/** OrderDrawer's "Código gobernado" section: each path and whether it's synced with the blueprint. */
import type { ReactElement } from 'react';
import { CODE_REFS } from '../../data';
import styles from './OrderDrawer.module.css';

function codeSyncStatus(path: string): 'synced' | 'out_of_sync' {
  return CODE_REFS.find((ref) => ref.path === path)?.status ?? 'synced';
}

export interface OrderGovernedCodeSectionProps {
  readonly governedPaths: readonly string[];
}

export function OrderGovernedCodeSection({ governedPaths }: OrderGovernedCodeSectionProps): ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Código gobernado</h3>
      <ul className={styles.paths}>
        {governedPaths.map((path) => {
          const status = codeSyncStatus(path);
          return (
            <li key={path} className={styles.pathRow}>
              <span className={`id ${styles.pathText}`}>{path}</span>
              <span className={[styles.pathStatus, status === 'synced' ? styles.pathSynced : styles.pathOutOfSync].join(' ')}>
                {status === 'synced' ? 'Sincronizado' : 'Fuera de sincronía'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
