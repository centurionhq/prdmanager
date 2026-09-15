/**
 * Read-only/connection banners for `DocumentDetail`/`CollabEditor` (SDD-013 §"Documentos", WO-358,
 * `DocumentoEstados.dc.html`): the exact copy the canvas approved for each reason a document (or the
 * live connection to it) isn't editable right now.
 */
import { Archive, Box, Lock, WifiOff } from 'lucide-react';
import type { ReactElement } from 'react';
import styles from './DocumentStateBanner.module.css';

export type DocumentBannerVariant = 'generado' | 'archivado' | 'solo_lectura' | 'desconectado';

export interface DocumentStateBannerProps {
  readonly variant: DocumentBannerVariant;
}

const COPY: Record<DocumentBannerVariant, string> = {
  generado: 'Este documento lo escribió el motor (feedback o work order). Es de solo lectura: solo cambia con operaciones del engine.',
  archivado: 'Archivado: ningún documento publicado lo enlaza ya. Sigue en el grafo, de solo lectura.',
  solo_lectura: 'Ves la copia de trabajo en solo lectura: tu rol puede comentar pero no editar.',
  desconectado: 'Se cortó la conexión en tiempo real. Reconectando… Los cambios locales se reenvían al volver.',
};

const ICON: Record<DocumentBannerVariant, typeof Box> = {
  generado: Box,
  archivado: Archive,
  solo_lectura: Lock,
  desconectado: WifiOff,
};

const VARIANT_CLASS: Record<DocumentBannerVariant, string | undefined> = {
  generado: styles.neutral,
  archivado: styles.neutral,
  solo_lectura: styles.neutral,
  desconectado: styles.alert,
};

/** `desconectado` is the only variant that's actually urgent (`role="alert"`) — the other three describe
 * a normal, expected state of the document, not a problem. */
export function DocumentStateBanner({ variant }: DocumentStateBannerProps): ReactElement {
  const Icon = ICON[variant];
  const className = [styles.banner, VARIANT_CLASS[variant]].filter((value): value is string => Boolean(value)).join(' ');
  return (
    <div className={className} role={variant === 'desconectado' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" size={18} className={styles.icon} />
      <span>{COPY[variant]}</span>
    </div>
  );
}
