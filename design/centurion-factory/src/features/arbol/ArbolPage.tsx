import { useMemo, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../../components';
import { FEATURES, getFeature } from '../../data';
import { useDemoState } from '../../lib/use-demo-state';
import styles from './ArbolPage.module.css';
import { FeatureTree } from './FeatureTree';
import { TraceabilityPanel } from './TraceabilityPanel';

/** `/arbol` with no id in the URL selects the root of the tree (SDD-011 §Árbol de features). */
const DEFAULT_FEATURE_ID = 'MRD-001';

export function ArbolPage(): ReactElement {
  const { id } = useParams<{ id?: string }>();
  const selectedId = id ?? DEFAULT_FEATURE_ID;
  const { state, retry } = useDemoState();
  const navigate = useNavigate();
  const feature = useMemo(() => getFeature(selectedId), [selectedId]);

  return (
    <div className={styles.page}>
      <PageHeader title="Árbol de features" subtitle="De la visión de mercado a cada feature request de prdmanager" />

      {state === 'cargando' ? <Skeleton rows={8} /> : null}

      {state === 'error' ? (
        <ErrorState
          title="No pudimos cargar el árbol"
          body="Algo falló al traer las features. Volvé a intentarlo."
          onRetry={retry}
        />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState
          title="Todavía no hay features"
          body="Cuando el proyecto tenga al menos una feature, va a aparecer acá."
        />
      ) : null}

      {state === 'listo' ? (
        feature ? (
          <div className={styles.layout}>
            <FeatureTree features={FEATURES} selectedId={selectedId} />
            <TraceabilityPanel feature={feature} />
          </div>
        ) : (
          <ErrorState
            title="No encontramos esa feature"
            body={`No encontramos la feature ${selectedId} en el árbol.`}
            retryLabel="Ir al árbol"
            onRetry={() => navigate('/arbol')}
          />
        )
      ) : null}
    </div>
  );
}
