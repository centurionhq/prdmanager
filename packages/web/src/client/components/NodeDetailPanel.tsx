import { Fragment, type ReactElement } from 'react';
import type { NodeDetail } from '@prdm/core';
import { getNode } from '../api/client';
import { useGraphData } from '../hooks/useGraphData';
import { useSelection } from '../state/selection';
import { EmptyState, ErrorState, LoadingState } from './StatusState';
import styles from './NodeDetailPanel.module.css';

const STATUS_GLOW = new Set(['approved', 'active', 'done', 'in_progress']);
const STATUS_ATTENTION = new Set(['out_of_sync']);

function statusBadgeClass(status: string): string {
  if (STATUS_ATTENTION.has(status)) return `${styles.badge} ${styles.badgeAttention}`;
  if (STATUS_GLOW.has(status)) return `${styles.badge} ${styles.badgeOk}`;
  return styles.badge ?? '';
}

/** Only the relation types a reader actually cares about seeing here; `GOVERNED_BY`/code refs stay in `/api/drift`. */
const VISIBLE_LINK_TYPES = new Set(['EVOLVES_FROM', 'ARCHITECTS', 'IMPLEMENTS', 'PROVIDES_CONTEXT_FOR', 'INFORMS', 'JUSTIFIED_BY']);

function NodeDetailContent({ detail }: { detail: NodeDetail }): ReactElement {
  const { select } = useSelection();
  const { node, links } = detail;
  const visibleLinks = links.filter((link) => VISIBLE_LINK_TYPES.has(link.type));

  return (
    <>
      <div>
        <p className={styles.eyebrow}>{node.label}</p>
        <p className={styles.id}>{node.id}</p>
        <p className={styles.docTitle}>{node.title}</p>
      </div>
      <div className={styles.badges}>
        <span className={statusBadgeClass(node.status)}>{node.status}</span>
        <span className={styles.badge}>{node.kind}</span>
      </div>
      <hr className={styles.sep} />
      <dl className={styles.kv}>
        <dt>Archivo</dt>
        <dd>{node.source_path}</dd>
        {node.created_at && (
          <>
            <dt>Creado</dt>
            <dd>{node.created_at}</dd>
          </>
        )}
        {node.tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{node.tags.join(', ')}</dd>
          </>
        )}
      </dl>
      {visibleLinks.length > 0 && (
        <>
          <hr className={styles.sep} />
          <div>
            <p className={styles.eyebrow}>Relaciones</p>
            <dl className={styles.kv}>
              {visibleLinks.map((link) => (
                <Fragment key={`${link.type}-${link.ref}`}>
                  <dt>{link.type.toLowerCase().replace(/_/g, ' ')}</dt>
                  <dd>
                    <button type="button" className={styles.link} onClick={() => select(link.ref)}>
                      {link.ref}
                    </button>
                  </dd>
                </Fragment>
              ))}
            </dl>
          </div>
        </>
      )}
    </>
  );
}

/**
 * `components/NodeDetailPanel.tsx` (SDD-005 "Frontend"): reads `useSelection()` directly instead of taking the
 * id as a prop, since it's always rendered once at a fixed position in `App.tsx`'s layout, not per-node.
 */
export function NodeDetailPanel(): ReactElement {
  const { selectedId } = useSelection();
  const { status, data, error, refetch } = useGraphData<NodeDetail | null>(
    () => (selectedId ? getNode(selectedId) : Promise.resolve(null)),
    [selectedId],
  );

  return (
    <aside className={styles.panel} aria-label="Detalle del nodo seleccionado">
      {!selectedId && <p className={styles.placeholder}>Seleccioná un nodo en el árbol, el grafo o la búsqueda para ver su detalle.</p>}
      {selectedId && status === 'loading' && <LoadingState label={`Cargando ${selectedId}…`} />}
      {selectedId && status === 'error' && <ErrorState error={error} onRetry={refetch} />}
      {selectedId && status === 'ready' && (data ? <NodeDetailContent detail={data} /> : <EmptyState label="Nodo no encontrado" />)}
    </aside>
  );
}
