import type { ReactElement } from 'react';
import styles from './IdTag.module.css';

export type IdTagTone = 'default' | 'blueprint' | 'muted';

export interface IdTagProps {
  readonly id: string;
  readonly tone?: IdTagTone;
}

const BLUEPRINT_ID_PATTERN = /^(SDD|ADR)-/;

const TONE_CLASS: Record<IdTagTone, string | null | undefined> = {
  default: null,
  blueprint: styles.blueprint,
  muted: styles.muted,
};

/** Literal identifier in mono type. Blueprint ids (SDD/ADR) get the cianotipo tone automatically. */
export function IdTag({ id, tone }: IdTagProps): ReactElement {
  const resolvedTone: IdTagTone = tone ?? (BLUEPRINT_ID_PATTERN.test(id) ? 'blueprint' : 'default');
  const className = ['id', styles.idTag, TONE_CLASS[resolvedTone]].filter((value): value is string => Boolean(value)).join(' ');

  return <span className={className}>{id}</span>;
}
