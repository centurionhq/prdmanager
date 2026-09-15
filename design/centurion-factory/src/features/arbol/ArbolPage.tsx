import { useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../../components';
import { FEATURES, type Feature } from '../../data';
import { useDemoState } from '../../lib/use-demo-state';
import { ArbolContent } from './ArbolContent';
import styles from './ArbolPage.module.css';

/** `/arbol` with no id in the URL selects the root of the tree (SDD-011 §Árbol de features). */
const DEFAULT_FEATURE_ID = 'MRD-001';

/** Applies the ids closed locally in this session on top of the mock FEATURES, without mutating it. */
function withClosedOverrides(features: readonly Feature[], closedIds: ReadonlySet<string>): readonly Feature[] {
  if (closedIds.size === 0) return features;
  return features.map((feature) =>
    closedIds.has(feature.id) && feature.status !== 'closed'
      ? { ...feature, status: 'closed', closedAt: feature.closedAt ?? new Date().toISOString() }
      : feature,
  );
}

export function ArbolPage(): ReactElement {
  const { id } = useParams<{ id?: string }>();
  const selectedId = id ?? DEFAULT_FEATURE_ID;
  const { state, retry } = useDemoState();
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(new Set());

  const features = useMemo(() => withClosedOverrides(FEATURES, closedIds), [closedIds]);
  const feature = features.find((entry) => entry.id === selectedId);

  function handleClosed(featureId: string): void {
    setClosedIds((previous) => new Set([...previous, featureId]));
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Árbol de features" subtitle="De la visión de mercado a cada feature request de prdmanager" />

      {state === 'cargando' ? <Skeleton rows={8} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar el árbol" body="Algo falló al traer las features. Volvé a intentarlo." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState title="Todavía no hay features" body="Cuando el proyecto tenga al menos una feature, va a aparecer acá." />
      ) : null}

      {state === 'listo' ? <ArbolContent features={features} selectedId={selectedId} feature={feature} onClosed={handleClosed} /> : null}
    </div>
  );
}
