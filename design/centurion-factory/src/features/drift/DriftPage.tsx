import { useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '../../components';
import buttonStyles from '../../components/Button/Button.module.css';
import { DRIFT_ISSUES } from '../../data';
import type { DriftIssue } from '../../data';
import { useDemoState } from '../../lib/use-demo-state';
import { AcknowledgeModal } from './AcknowledgeModal';
import { BranchPreviews } from './BranchPreviews';
import { DriftHistory } from './DriftHistory';
import { DriftIssuesList } from './DriftIssuesList';
import { DriftSummary } from './DriftSummary';
import { acknowledgeableTargets, issuesAcknowledgedBy, issuesForFeature } from './drift-issue-groups';
import { reportHistory } from './drift-data';
import styles from './DriftPage.module.css';

const FALLBACK_HEAD_SHA = '8f2c1d4';

/** The Drift screen (WO-293/WO-294): reports, grouped issues, the feature filter and the acknowledge modal. */
export function DriftPage(): ReactElement {
  const { state, retry } = useDemoState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [issues, setIssues] = useState<readonly DriftIssue[]>(DRIFT_ISSUES);
  const [modalOpen, setModalOpen] = useState(false);
  const { show } = useToast();

  const featureId = searchParams.get('feature');
  const visibleIssues = useMemo(() => issuesForFeature(featureId, issues), [featureId, issues]);
  const targets = useMemo(() => acknowledgeableTargets(issues), [issues]);
  const headSha = reportHistory()[0]?.headSha ?? FALLBACK_HEAD_SHA;

  function clearFeatureFilter(): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('feature');
      return next;
    });
  }

  function handleAcknowledge(target: string): void {
    const clearedIds = new Set(issuesAcknowledgedBy(target, issues).map((issue) => issue.id));
    setIssues((current) => current.filter((issue) => !clearedIds.has(issue.id)));
    setModalOpen(false);
    show('Drift reconocido', { tone: 'success' });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Drift"
        subtitle={
          <>
            Reporte oficial de <span className="id">main</span> · commit <span className="id">{headSha}</span> · hace 4 min
          </>
        }
        actions={
          <>
            <a href="#historial" className={`${buttonStyles.button} ${buttonStyles.secondary} ${styles.historyLink}`}>
              Ver historial
            </a>
            <Button type="button" variant="primary" onClick={() => setModalOpen(true)}>
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
          <DriftSummary issues={issues} />
          <div className={styles.columns}>
            <DriftIssuesList issues={visibleIssues} featureId={featureId} onClearFeature={clearFeatureFilter} />
            <div className={styles.sidebar}>
              <BranchPreviews />
              <DriftHistory />
            </div>
          </div>
        </div>
      ) : null}

      <AcknowledgeModal
        open={modalOpen}
        targets={targets}
        headSha={headSha}
        onClose={() => setModalOpen(false)}
        onConfirm={handleAcknowledge}
      />
    </div>
  );
}
