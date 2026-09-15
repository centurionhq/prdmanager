/**
 * `/o/:orgSlug/p/:projectSlug/graph` (SDD-007 "PgProjectEngine", WO-142): the published graph
 * (`GraphCanvas`/`TreeView`/`NodeDetailPanel`) plus the drift view (`DriftBanner` + `WorkOrderList`) and
 * an admin-only "Reconocer" action wired to WO-140's `POST .../drift/acknowledge` — the SaaS dashboard's
 * counterpart to `packages/web/src/client/App.tsx`'s local `ExplorerShell`, built from the exact same
 * `@prdm/ui` components (all of which only take injected fetcher props, never call a concrete backend).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import type { RefreshReport, Subgraph } from '@prdm/core';
import { can, type PermissionSubject } from '@prdm/contracts';
import {
  DriftBanner,
  ErrorState,
  GraphCanvas,
  LoadingState,
  NodeDetailPanel,
  SelectionProvider,
  TreeView,
  WorkOrderList,
  collectDriftIds,
  useGraphData,
} from '@prdm/ui';
import { acknowledgeDrift, getDrift, getFullGraph, getNode, getSession, getTree, listProjectMembers, listWorkOrders, type TreeResponse } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';
import styles from '../styles/graph.module.css';

const EMPTY_GRAPH: Subgraph = { nodes: [], edges: [] };
const EMPTY_DRIFT_IDS: ReadonlySet<string> = new Set();

function AcknowledgeForm({ orgSlug, projectSlug, onAcknowledged }: { orgSlug: string; projectSlug: string; onAcknowledged: () => void }): ReactElement {
  const [target, setTarget] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!target.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await acknowledgeDrift(orgSlug, projectSlug, target.trim());
      onAcknowledged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.ackForm} onSubmit={handleSubmit} noValidate>
      <label htmlFor="ack-target">Reconocer</label>
      <input id="ack-target" type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="all, WO-001, SDD-001…" />
      <button type="submit" className={formStyles.primaryButton} disabled={busy}>
        Reconocer
      </button>
      <FormError message={error} />
    </form>
  );
}

function GraphShell({ orgSlug, projectSlug, canAcknowledge }: { orgSlug: string; projectSlug: string; canAcknowledge: boolean }): ReactElement {
  const graph = useGraphData<Subgraph>(() => getFullGraph(orgSlug, projectSlug), [orgSlug, projectSlug]);
  const tree = useGraphData<TreeResponse>(() => getTree(orgSlug, projectSlug), [orgSlug, projectSlug]);
  const drift = useGraphData<RefreshReport>(() => getDrift(orgSlug, projectSlug), [orgSlug, projectSlug]);

  const refreshAll = useCallback(() => {
    graph.refetch();
    tree.refetch();
    drift.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isRefreshing = graph.status === 'loading' || tree.status === 'loading' || drift.status === 'loading';
  const driftIds = useMemo(() => (drift.data ? collectDriftIds(drift.data) : EMPTY_DRIFT_IDS), [drift.data]);

  return (
    <div className={styles.shell}>
      <p>
        <Link className={formStyles.link} to={`/o/${orgSlug}/p/${projectSlug}/drift`}>
          Ver drift verificado por CI (oficial, vistas previas e historial)
        </Link>
      </p>
      {drift.status === 'ready' && drift.data && <DriftBanner report={drift.data} />}
      {drift.status === 'error' && <ErrorState error={drift.error} onRetry={drift.refetch} />}

      {canAcknowledge && <AcknowledgeForm orgSlug={orgSlug} projectSlug={projectSlug} onAcknowledged={refreshAll} />}

      <div className={styles.grid}>
        {tree.status === 'ready' && tree.data ? (
          <TreeView forest={tree.data.forest} driftIds={driftIds} />
        ) : tree.status === 'error' ? (
          <ErrorState error={tree.error} onRetry={tree.refetch} />
        ) : (
          <LoadingState label="Cargando árbol…" />
        )}

        {graph.status === 'ready' ? (
          <GraphCanvas graph={graph.data ?? EMPTY_GRAPH} drift={drift.data} onRefresh={refreshAll} refreshing={isRefreshing} />
        ) : graph.status === 'error' ? (
          <ErrorState error={graph.error} onRetry={graph.refetch} />
        ) : (
          <LoadingState label="Cargando grafo…" />
        )}

        <NodeDetailPanel fetchNode={(id) => getNode(orgSlug, projectSlug, id)} />
      </div>

      <WorkOrderList fetchWorkOrders={(filter) => listWorkOrders(orgSlug, projectSlug, filter)} />
    </div>
  );
}

export function ProjectGraph(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [subject, setSubject] = useState<PermissionSubject | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Grafo');

  useEffect(() => {
    if (!projectSlug) return;
    let cancelled = false;
    setSubject(null);
    setError(null);
    Promise.all([getSession(), listProjectMembers(orgSlug, projectSlug)])
      .then(([session, members]) => {
        if (cancelled) return;
        const own = session ? members.find((m) => m.userId === session.user.id) : undefined;
        setSubject({ orgRole: currentOrg.role, projectRole: own?.role });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug]);

  if (error) return <FormError message={error} />;
  if (!subject || !projectSlug) return <LoadingState label="Cargando proyecto…" />;

  return (
    <SelectionProvider>
      <GraphShell orgSlug={orgSlug} projectSlug={projectSlug} canAcknowledge={can(subject, 'acknowledge_drift')} />
    </SelectionProvider>
  );
}
