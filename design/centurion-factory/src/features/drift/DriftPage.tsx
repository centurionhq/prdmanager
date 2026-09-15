import type { ReactElement } from 'react';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components';
import buttonStyles from '../../components/Button/Button.module.css';
import { useDemoState } from '../../lib/use-demo-state';
import { BranchPreviews } from './BranchPreviews';
import { DriftHistory } from './DriftHistory';
import { DriftSummary } from './DriftSummary';
import styles from './DriftPage.module.css';

function noop(): void {
  // No-op until WO-294 wires the acknowledge modal.
}

/**
 * The Drift screen (WO-293): the header, the summary strip and the branch previews / history.
 * The Issues list and the "Reconocer drift" modal are wired in WO-294.
 */
export function DriftPage(): ReactElement {
  const { state, retry } = useDemoState();

  return (
    <div className={styles.page}>
      <PageHeader
        title="Drift"
        subtitle={
          <>
            Reporte oficial de <span className="id">main</span> · commit <span className="id">8f2c1d4</span> · hace 4 min
          </>
        }
        actions={
          <>
            <a href="#historial" className={`${buttonStyles.button} ${buttonStyles.secondary} ${styles.historyLink}`}>
              Ver historial
            </a>
            {/* Opens the acknowledge modal starting in WO-294. */}
            <Button type="button" variant="primary" onClick={noop}>
              Reconocer drift
            </Button>
          </>
        }
      />

      {state === 'cargando' ? <Skeleton rows={6} /> : null}

      {state === 'vacio' ? (
        <EmptyState title="No hay drift pendiente de revisar." body="El último reporte de main no encontró issues abiertos." />
      ) : null}

      {state === 'error' ? (
        <ErrorState
          title="No pudimos leer el reporte de CI de feat/fr-002-importer."
          body="Reintentá o revisá que el token prdm_ci_… siga vigente."
          onRetry={retry}
        />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.body}>
          <DriftSummary />
          <BranchPreviews />
          <DriftHistory />
        </div>
      ) : null}
    </div>
  );
}
