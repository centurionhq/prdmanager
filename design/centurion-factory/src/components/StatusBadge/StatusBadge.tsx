import type { ReactElement } from 'react';
import styles from './StatusBadge.module.css';

export type StatusBadgeWorkflowStatus = 'draft' | 'in_review' | 'published' | 'archived';
export type StatusBadgeWorkOrderStatus = 'pending' | 'in_progress' | 'out_of_sync' | 'done';
export type StatusBadgeFeatureStatus = 'draft' | 'proposed' | 'approved' | 'closed';

export type StatusBadgeProps =
  | { readonly kind: 'workflow'; readonly status: StatusBadgeWorkflowStatus }
  | { readonly kind: 'workOrder'; readonly status: StatusBadgeWorkOrderStatus }
  | { readonly kind: 'feature'; readonly status: StatusBadgeFeatureStatus };

type Tone = 'neutral' | 'cianotipo' | 'senal' | 'paro' | 'apagado' | 'andon';
type Mark = 'hollow' | 'cianotipo' | 'senal' | 'paro' | 'apagado' | 'andon' | 'regla';

interface StatusConfig {
  readonly label: string;
  readonly tone: Tone;
  readonly mark: Mark;
  readonly archived?: boolean;
}

// Documento / workflow lifecycle — see "Badges de estado" on Componentes.dc.html.
const WORKFLOW_CONFIG: Record<StatusBadgeWorkflowStatus, StatusConfig> = {
  draft: { label: 'Borrador', tone: 'neutral', mark: 'hollow' },
  in_review: { label: 'En revisión', tone: 'cianotipo', mark: 'cianotipo' },
  published: { label: 'Publicado', tone: 'senal', mark: 'senal' },
  archived: { label: 'Archivado', tone: 'apagado', mark: 'regla', archived: true },
};

const WORK_ORDER_CONFIG: Record<StatusBadgeWorkOrderStatus, StatusConfig> = {
  pending: { label: 'Pendiente', tone: 'neutral', mark: 'hollow' },
  in_progress: { label: 'En curso', tone: 'cianotipo', mark: 'cianotipo' },
  out_of_sync: { label: 'Fuera de sincronía', tone: 'paro', mark: 'paro' },
  done: { label: 'Hecha', tone: 'senal', mark: 'senal' },
};

// "proposed" has no example on the canvas; it borrows the andon (aviso) tone used for
// "awaiting a decision" states elsewhere in the system, between the hollow draft mark and
// the cianotipo "approved" mark the canvas does show.
const FEATURE_CONFIG: Record<StatusBadgeFeatureStatus, StatusConfig> = {
  draft: { label: 'Borrador', tone: 'neutral', mark: 'hollow' },
  proposed: { label: 'Propuesta', tone: 'andon', mark: 'andon' },
  approved: { label: 'Aprobada', tone: 'cianotipo', mark: 'cianotipo' },
  closed: { label: 'Cerrada', tone: 'apagado', mark: 'apagado' },
};

const TONE_CLASS: Record<Tone, string | undefined> = {
  neutral: styles.toneNeutral,
  cianotipo: styles.toneCianotipo,
  senal: styles.toneSenal,
  paro: styles.toneParo,
  apagado: styles.toneApagado,
  andon: styles.toneAndon,
};

const MARK_CLASS: Record<Mark, string | undefined> = {
  hollow: styles.markHollow,
  cianotipo: styles.markCianotipo,
  senal: styles.markSenal,
  paro: styles.markParo,
  apagado: styles.markApagado,
  andon: styles.markAndon,
  regla: styles.markRegla,
};

function getConfig(props: StatusBadgeProps): StatusConfig {
  switch (props.kind) {
    case 'workflow':
      return WORKFLOW_CONFIG[props.status];
    case 'workOrder':
      return WORK_ORDER_CONFIG[props.status];
    case 'feature':
      return FEATURE_CONFIG[props.status];
  }
}

/** Square fill/hollow status badge with Spanish labels, per the Componentes artboard. */
export function StatusBadge(props: StatusBadgeProps): ReactElement {
  const config = getConfig(props);
  const badgeClassName = [styles.badge, config.archived ? styles.archived : null, TONE_CLASS[config.tone]]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const markClassName = [styles.mark, MARK_CLASS[config.mark]].join(' ');

  return (
    <span className={badgeClassName}>
      <span className={markClassName} aria-hidden="true" />
      {config.label}
    </span>
  );
}
