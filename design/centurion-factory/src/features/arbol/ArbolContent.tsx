/** ArbolPage's "listo" content: the tree, the traceability panel, and the closure modal. */
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { ErrorState } from '../../components';
import type { Feature } from '../../data';
import styles from './ArbolPage.module.css';
import { ClosureModal } from './ClosureModal';
import { FeatureTree } from './FeatureTree';
import { TraceabilityPanel } from './TraceabilityPanel';

export interface ArbolContentProps {
  readonly features: readonly Feature[];
  readonly selectedId: string;
  readonly feature: Feature | undefined;
  readonly onClosed: (featureId: string) => void;
}

export function ArbolContent({ features, selectedId, feature, onClosed }: ArbolContentProps): ReactElement {
  const navigate = useNavigate();
  const [closureOpen, setClosureOpen] = useState(false);

  if (!feature) {
    return (
      <ErrorState
        title="No encontramos esa feature"
        body={`No encontramos la feature ${selectedId} en el árbol.`}
        retryLabel="Ir al árbol"
        onRetry={() => navigate('/arbol')}
      />
    );
  }

  return (
    <div className={styles.layout}>
      <FeatureTree features={features} selectedId={selectedId} />
      <TraceabilityPanel feature={feature} onOpenClosure={() => setClosureOpen(true)} />
      <ClosureModal feature={feature} open={closureOpen} onClose={() => setClosureOpen(false)} onClosed={onClosed} />
    </div>
  );
}
