import { Filter } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../Button/Button';
import styles from './EmptyState.module.css';

export interface EmptyStateAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string;
  readonly action?: EmptyStateAction;
}

/** "Estado vacío" plate: outline icon, title, optional body and a secondary action. */
export function EmptyState({ title, body, action }: EmptyStateProps): ReactElement {
  return (
    <div className={styles.emptyState}>
      <Filter aria-hidden="true" size={20} className={styles.icon} />
      <span className={styles.title}>{title}</span>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action ? (
        <Button type="button" variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
