/**
 * `/o/:orgSlug/p/:projectSlug/arbol/:id?` (Centurion Factory "Árbol de features", SDD-012, WO-355): a
 * keyboard-navigable ARIA tree of the project's documents (`getTree`) plus a traceability panel for the
 * selected node (`getNode`, and `getFeatureBranch`/`listCodeRefs`/`listCommits` for richer counts) and the
 * "Cerrar feature" confirmation modal (`getClosureReadiness`/`closeFeature`). See canvas/Arbol.dc.html.
 * Deliberately drops `@prdm/ui`'s `GraphCanvas`/`TreeView`/`NodeDetailPanel` (Stark HUD tokens, not this
 * design's) — every style here comes from `src/styles/tokens.css` instead (WO-461: via this route's own
 * CSS module, plus `FeatureTree`'s, now that the tree itself is a design-system component).
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CodeRefDto, CommitDto, DriftIssueDto } from '@prdm/contracts';
import { can } from '@prdm/contracts';
import type { NodeDetail, NodeLink, NodeView, Subgraph, TreeNode } from '@prdm/core';
import type { ClosureCheck, ClosureReadiness } from '@prdm/core';
import {
  closeFeature,
  getClosureReadiness,
  getDriftIssues,
  getFeatureBranch,
  getNode,
  getTree,
  listCodeRefs,
  listCommits,
  type CommitsPage,
} from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiMutation } from '../api/use-api-mutation.js';
import { useApiQuery } from '../api/use-api-query.js';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FeatureTree,
  IdTag,
  Modal,
  PageHeader,
  SearchField,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
  type StatusBadgeFeatureStatus,
  type StatusBadgeWorkOrderStatus,
  type StatusBadgeWorkflowStatus,
} from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import styles from './ProjectGraph.module.css';
import { useProjectShellContext } from './ProjectShell.js';

const FEATURE_STATUSES = new Set<StatusBadgeFeatureStatus>(['draft', 'proposed', 'approved', 'closed']);
const WORK_ORDER_STATUSES = new Set<StatusBadgeWorkOrderStatus>(['pending', 'in_progress', 'out_of_sync', 'done']);
const WORKFLOW_STATUSES = new Set<StatusBadgeWorkflowStatus>(['draft', 'in_review', 'published', 'archived']);

// --- Pure tree helpers (no React), operating directly on @prdm/core's already-nested TreeNode ---

function relatedRefs(links: readonly NodeLink[], type: string, direction: 'in' | 'out'): readonly NodeLink[] {
  return links.filter((link) => link.type === type && link.direction === direction);
}

/** The first ref, anywhere in the raw forest, where a node sits under a `BC` via a `JUSTIFIED_BY` edge --
 * "first" mirrors station.ts's `justifyingBc` picking the first `justified_by` id that resolves to a
 * present BC. `buildForest` (server) renders every ref once per incoming edge it has: fully under
 * whichever parent's traversal reaches it first, and again as an empty `repeated` stub under any other
 * parent. So a PRD justified by a BC but reached first through its MRD's `EVOLVES_FROM` still leaves a
 * `via: 'JUSTIFIED_BY'` stub under that BC -- this signal is read from data `getTree` already returns, no
 * extra request and no re-deriving `station.ts`'s rule from frontmatter (SDD-029's own decision). */
function findBcParentRefs(rawForest: readonly TreeNode[]): ReadonlyMap<string, string> {
  const bcParentRefOf = new Map<string, string>();
  function walk(nodes: readonly TreeNode[], parent: TreeNode | undefined): void {
    for (const node of nodes) {
      if (node.via === 'JUSTIFIED_BY' && parent?.kind === 'BC' && !bcParentRefOf.has(node.ref)) {
        bcParentRefOf.set(node.ref, parent.ref);
      }
      walk(node.children, node);
    }
  }
  walk(rawForest, undefined);
  return bcParentRefOf;
}

/** The fully-rendered (non-`repeated`) occurrence of every ref anywhere in the raw forest -- the one with
 * its real children, as opposed to the empty stubs `buildForest` leaves under every other parent. */
function findFullNodes(rawForest: readonly TreeNode[]): ReadonlyMap<string, TreeNode> {
  const fullNodes = new Map<string, TreeNode>();
  function walk(nodes: readonly TreeNode[]): void {
    for (const node of nodes) {
      if (!node.repeated) fullNodes.set(node.ref, node);
      walk(node.children);
    }
  }
  walk(rawForest);
  return fullNodes;
}

/** WO-457 (SDD-029): the raw `getTree` forest mixes features with blueprints, work orders, commits and
 * code paths, and renders a PRD/FR under its `EVOLVES_FROM` parent even when it has a justifying BC. This
 * rebuilds a features-only forest, with each PRD/FR nested under the first BC its `JUSTIFIED_BY` edge
 * resolves to (falling back to its natural place when it has none), dropping every non-`Feature` node
 * (promoting its `Feature` descendants, if any, to its position) and every duplicate `repeated` stub. */
function buildFeatureForest(rawForest: readonly TreeNode[]): readonly TreeNode[] {
  const bcParentRefOf = findBcParentRefs(rawForest);
  const fullNodes = findFullNodes(rawForest);

  function rebuildChildren(node: TreeNode): TreeNode[] {
    const full = fullNodes.get(node.ref) ?? node;
    return full.children.flatMap((child) => renderAt(child, full));
  }

  function renderAt(child: TreeNode, parent: TreeNode): TreeNode[] {
    const isBcHome = child.via === 'JUSTIFIED_BY' && parent.kind === 'BC' && bcParentRefOf.get(child.ref) === parent.ref;
    if (!isBcHome && bcParentRefOf.has(child.ref)) return []; // nests under its BC elsewhere instead
    if (!isBcHome && child.repeated) return []; // duplicate stub, the real rendering is elsewhere
    const full = fullNodes.get(child.ref) ?? child;
    if (full.label !== 'Feature') return rebuildChildren(full); // drop it, promote its feature descendants
    return [{ ...full, children: rebuildChildren(full) }];
  }

  const root: TreeNode = { ref: '', label: '', kind: null, title: '', status: null, via: null, edgeStatus: null, reviewNeeded: false, repeated: false, children: [...rawForest] };
  return rebuildChildren(root);
}

/** Total features and how many are closed, over the whole forest regardless of what's expanded or filtered
 * out by the search box -- the header count always describes the real tree, not the current search. */
function countFeatures(nodes: readonly TreeNode[]): { readonly total: number; readonly closed: number } {
  return nodes.reduce(
    (acc, node) => {
      const fromChildren = countFeatures(node.children);
      return { total: acc.total + 1 + fromChildren.total, closed: acc.closed + (node.status === 'closed' ? 1 : 0) + fromChildren.closed };
    },
    { total: 0, closed: 0 },
  );
}

/** WO-461: the header's "Buscar por id o título" -- keeps a node if it (or any descendant) matches, so a
 * match's ancestors stay visible for context instead of the match showing up disconnected from its tree. */
function filterForestByQuery(nodes: readonly TreeNode[], query: string): TreeNode[] {
  if (!query) return [...nodes];
  return nodes.flatMap((node) => {
    const children = filterForestByQuery(node.children, query);
    const matches = node.ref.toLowerCase().includes(query) || node.title.toLowerCase().includes(query);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}

// --- TraceabilityPanel: the right-hand detail for the selected node ---

function renderStatus(view: NodeView): ReactElement {
  if (view.label === 'Feature' && FEATURE_STATUSES.has(view.status as StatusBadgeFeatureStatus)) {
    return <StatusBadge kind="feature" status={view.status as StatusBadgeFeatureStatus} />;
  }
  if (view.label === 'WorkOrder' && WORK_ORDER_STATUSES.has(view.status as StatusBadgeWorkOrderStatus)) {
    return <StatusBadge kind="workOrder" status={view.status as StatusBadgeWorkOrderStatus} />;
  }
  if (WORKFLOW_STATUSES.has(view.status as StatusBadgeWorkflowStatus)) {
    return <StatusBadge kind="workflow" status={view.status as StatusBadgeWorkflowStatus} />;
  }
  return <span className={styles.statusFallback}>{view.status}</span>;
}

interface FeatureOrderRow {
  readonly ref: string;
  readonly title: string;
  readonly status: string | null;
  readonly commit: CommitDto | null;
}

const ORDER_COLUMNS: readonly DataTableColumn<FeatureOrderRow>[] = [
  { key: 'ref', header: 'Orden', render: (row) => <IdTag id={row.ref} /> },
  { key: 'title', header: 'Título', render: (row) => row.title },
  {
    key: 'status',
    header: 'Estado',
    render: (row) =>
      row.status && WORK_ORDER_STATUSES.has(row.status as StatusBadgeWorkOrderStatus) ? <StatusBadge kind="workOrder" status={row.status as StatusBadgeWorkOrderStatus} /> : (row.status ?? '—'),
  },
  { key: 'commit', header: 'Commit', render: (row) => (row.commit ? <span className="id">{row.commit.sha.slice(0, 7)}</span> : '—') },
  { key: 'date', header: 'Fecha', align: 'end', render: (row) => row.commit?.date ?? '—' },
];

interface CodeRefRow {
  readonly refKey: string;
  readonly path: string;
  readonly symbol: string | null;
}

const CODE_COLUMNS: readonly DataTableColumn<CodeRefRow>[] = [
  { key: 'path', header: 'Ruta', render: (row) => <span className="id">{row.path}</span> },
  { key: 'symbol', header: 'Símbolo', render: (row) => row.symbol ?? '—' },
];

interface TraceabilityPanelProps {
  readonly detail: NodeDetail;
  readonly branch: Subgraph | null;
  readonly codeRefs: readonly CodeRefDto[] | null;
  readonly commits: CommitsPage | null;
  readonly canClose: boolean;
  readonly ordersHref: string;
  readonly onOpenClosure: () => void;
}

function TraceabilityPanel({ detail, branch, codeRefs, commits, canClose, ordersHref, onOpenClosure }: TraceabilityPanelProps): ReactElement {
  const { node: view, links } = detail;
  const parent = relatedRefs(links, 'EVOLVES_FROM', 'out')[0];
  const children = relatedRefs(links, 'EVOLVES_FROM', 'in');
  const origin = [...relatedRefs(links, 'JUSTIFIED_BY', 'out'), ...relatedRefs(links, 'PROVIDES_CONTEXT_FOR', 'out'), ...relatedRefs(links, 'INFORMS', 'out')];
  const blueprintsIn = relatedRefs(links, 'ARCHITECTS', 'in');
  const workOrdersIn = relatedRefs(links, 'IMPLEMENTS', 'in');
  const architects = relatedRefs(links, 'ARCHITECTS', 'out')[0];

  const branchWorkOrders = branch?.nodes.filter((node) => node.label === 'WorkOrder') ?? [];
  const branchBlueprints = branch?.nodes.filter((node) => node.label === 'Blueprint') ?? [];
  const doneWorkOrders = branchWorkOrders.filter((node) => node.status === 'done').length;

  // For a Feature, `codeRefs`/`commits` are project-wide -- narrow them to the feature's own blueprints
  // (from `branch`, already fetched). For a Blueprint (no `branch`), `view.id` is that blueprint's own id.
  const branchBlueprintIds = new Set(branchBlueprints.map((node) => node.ref));
  const relatedCodeRefs = codeRefs?.filter((ref) => (branch ? branchBlueprintIds.has(ref.blueprintId) : ref.blueprintId === view.id)) ?? [];
  const relatedCommits = commits?.items.filter((commit) => (branch ? commit.refs.some((ref) => branchBlueprintIds.has(ref)) : commit.refs.includes(view.id))) ?? [];

  // WO-459: each work order's own commit is whichever commit's `refs` names that order's id directly --
  // the trailer convention every commit in this repo already follows (`Refs: WO-xxx`).
  const orderRows: readonly FeatureOrderRow[] = branchWorkOrders.map((node) => ({
    ref: node.ref,
    title: node.title,
    status: node.status,
    commit: commits?.items.find((commit) => commit.refs.includes(node.ref)) ?? null,
  }));

  // WO-460: every block above is conditional on having something to show -- a document with none of
  // these (no lineage, not a feature/blueprint so no branch/code/commits) used to leave the "Trazabilidad"
  // heading with nothing under it. This also covers a non-feature document reached directly by url: the
  // tree is features-only since WO-457, so a WorkOrder/Artifact/Feedback id typed into the url still gets
  // a real header (`renderStatus` already handles every label) but would otherwise fall through to the
  // same blank section.
  const hasTraceabilityContent = origin.length > 0 || children.length > 0 || blueprintsIn.length > 0 || workOrdersIn.length > 0 || branch !== null || codeRefs !== null || commits !== null;

  return (
    <div className={styles.panel}>
      <header className={styles.panelHeader}>
        <div className={styles.panelHeaderMain}>
          <div className={styles.panelIdRow}>
            <IdTag id={view.id} />
            {renderStatus(view)}
          </div>
          <h2 className={styles.panelTitle}>{view.title}</h2>
          {parent ? (
            <p className={styles.panelLineage}>
              Hija de <IdTag id={parent.ref} />
            </p>
          ) : null}
          {architects ? (
            <p className={styles.panelLineage}>
              Arquitecta a <IdTag id={architects.ref} />
            </p>
          ) : null}
        </div>
        {canClose ? (
          <Button type="button" variant="secondary" onClick={onOpenClosure}>
            Cerrar feature
          </Button>
        ) : null}
      </header>

      <section aria-label="Trazabilidad">
        <h3 className={styles.sectionTitle}>Trazabilidad</h3>
        {hasTraceabilityContent ? (
          <dl className={styles.traceGrid}>
            {origin.length > 0 ? (
              <div>
                <dt className={styles.traceLabel}>Origen</dt>
                <dd className={styles.traceValue}>{origin.map((link) => link.ref).join(', ')}</dd>
              </div>
            ) : null}
            {children.length > 0 ? (
              <div>
                <dt className={styles.traceLabel}>Features hijas</dt>
                <dd className={styles.traceValue}>{children.map((link) => link.ref).join(', ')}</dd>
              </div>
            ) : null}
            {blueprintsIn.length > 0 || branch ? (
              <div>
                <dt className={styles.traceLabel}>Blueprints</dt>
                <dd className={`num ${styles.traceValueNum}`}>{branch ? branchBlueprints.length : blueprintsIn.length}</dd>
              </div>
            ) : null}
            {workOrdersIn.length > 0 || branch ? (
              <div>
                <dt className={styles.traceLabel}>Órdenes</dt>
                <dd className={`num ${styles.traceValueNum}`}>{branch ? `${doneWorkOrders} de ${branchWorkOrders.length} hechas` : workOrdersIn.length}</dd>
                {branch && branchWorkOrders.length > 0 ? (
                  <Link to={ordersHref} className={styles.ordersLink}>
                    Ver las {branchWorkOrders.length} órdenes
                  </Link>
                ) : null}
              </div>
            ) : null}
            {codeRefs ? (
              <div>
                <dt className={styles.traceLabel}>Código</dt>
                <dd className={`num ${styles.traceValueCode}`}>
                  {relatedCodeRefs.length} {relatedCodeRefs.length === 1 ? 'referencia' : 'referencias'}
                </dd>
              </div>
            ) : null}
            {commits ? (
              <div>
                <dt className={styles.traceLabel}>Commits</dt>
                <dd className={`num ${styles.traceValueNum}`}>
                  {relatedCommits.length} {relatedCommits.length === 1 ? 'commit' : 'commits'}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <EmptyState
            title="Todavía no hay trazabilidad"
            body="Este documento no tiene blueprints, órdenes ni commits vinculados todavía. A medida que el trabajo avance -- un SDD que lo architecte, una orden que se genere -- va a aparecer acá."
          />
        )}
      </section>

      {branch && orderRows.length > 0 ? (
        <section aria-label="Órdenes de la feature">
          <h3 className={styles.sectionTitle}>Órdenes recientes</h3>
          <DataTable caption={`Órdenes de ${view.id}`} columns={ORDER_COLUMNS} rows={orderRows} getRowId={(row) => row.ref} />
        </section>
      ) : null}

      {branch && relatedCodeRefs.length > 0 ? (
        <section aria-label="Código gobernado">
          <h3 className={styles.sectionTitle}>Código gobernado</h3>
          <DataTable
            caption={`Código gobernado por ${view.id}`}
            columns={CODE_COLUMNS}
            rows={relatedCodeRefs.map((ref) => ({ refKey: ref.refKey, path: ref.path, symbol: ref.symbol }))}
            getRowId={(row) => row.refKey}
          />
        </section>
      ) : null}
    </div>
  );
}

// --- ClosureModal: the "Cerrar feature" confirmation ---

function CheckRow({ check }: { readonly check: ClosureCheck }): ReactElement {
  return (
    <li className={styles.checkRow}>
      <span aria-hidden="true" className={check.ok ? styles.checkIcon : `${styles.checkIcon} ${styles.checkIconFail}`}>
        {check.ok ? '✓' : '✗'}
      </span>
      <span className={check.ok ? styles.checkDetail : `${styles.checkDetail} ${styles.checkDetailFail}`}>{check.detail}</span>
    </li>
  );
}

interface ClosureModalProps {
  readonly open: boolean;
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly onClose: () => void;
  readonly onClosed: () => void;
}

function ClosureModal({ open, orgSlug, projectSlug, featureId, featureTitle, onClose, onClosed }: ClosureModalProps): ReactElement {
  const readinessQuery = useApiQuery<ClosureReadiness | null>(
    open ? `closure-readiness:${orgSlug}:${projectSlug}:${featureId}` : 'closure-readiness:none',
    () => (open ? getClosureReadiness(orgSlug, projectSlug, featureId) : Promise.resolve(null)),
    [orgSlug, projectSlug, featureId, open],
    (data) => data === null,
  );
  const mutation = useApiMutation(() => closeFeature(orgSlug, projectSlug, featureId));

  async function handleConfirm(): Promise<void> {
    await mutation.mutate(undefined);
    onClosed();
  }

  const readiness = readinessQuery.data;
  const passCount = readiness?.checks.filter((check) => check.ok).length ?? 0;

  return (
    <Modal
      open={open}
      title="Cerrar feature"
      description={`${featureId} ${featureTitle}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={!readiness?.ready || mutation.status === 'cargando'} onClick={() => void handleConfirm()}>
            Confirmar cierre
          </Button>
        </>
      }
    >
      {readinessQuery.status === 'cargando' ? <Skeleton rows={5} /> : null}
      {readinessQuery.status === 'error' ? <ErrorState title="No pudimos revisar los checks de cierre" body={errorMessage(readinessQuery.error)} onRetry={readinessQuery.retry} /> : null}
      {readiness ? (
        <>
          <p className={styles.readinessSummary}>
            {passCount} de {readiness.checks.length} checks pasan
          </p>
          <ul className={styles.checkList}>
            {readiness.checks.map((check) => (
              <CheckRow key={check.name} check={check} />
            ))}
          </ul>
          {mutation.status === 'error' ? <p role="alert">{errorMessage(mutation.error)}</p> : null}
        </>
      ) : null}
    </Modal>
  );
}

// --- ProjectGraph: composes the tree, the panel and the closure modal ---

export function ProjectGraph(): ReactElement {
  const { orgSlug, projectSlug, subject } = useProjectShellContext();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [closureOpen, setClosureOpen] = useState(false);
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  useDocumentTitle('Árbol de features');

  const treeQuery = useApiQuery(
    `tree:${orgSlug}:${projectSlug}`,
    () => getTree(orgSlug, projectSlug).then((response) => response.forest),
    [orgSlug, projectSlug],
    (forest) => forest.length === 0,
  );
  const forest = useMemo(() => buildFeatureForest(treeQuery.data ?? []), [treeQuery.data]);
  const visibleForest = useMemo(() => filterForestByQuery(forest, searchQuery.trim().toLowerCase()), [forest, searchQuery]);
  const selectedRef = id ?? forest[0]?.ref;

  const driftQuery = useApiQuery<readonly DriftIssueDto[]>(
    `drift-issues:${orgSlug}:${projectSlug}`,
    () => getDriftIssues(orgSlug, projectSlug),
    [orgSlug, projectSlug],
    (issues) => issues.length === 0,
  );
  const driftRefs = useMemo(() => new Set((driftQuery.data ?? []).flatMap((issue) => issue.featureIds)), [driftQuery.data]);

  const nodeQuery = useApiQuery<NodeDetail | null>(
    selectedRef ? `node:${orgSlug}:${projectSlug}:${selectedRef}` : 'node:none',
    () => (selectedRef ? getNode(orgSlug, projectSlug, selectedRef) : Promise.resolve(null)),
    [orgSlug, projectSlug, selectedRef],
    (data) => data === null,
  );
  const detail = nodeQuery.data;
  const isFeature = detail?.node.label === 'Feature';
  const isBlueprint = detail?.node.label === 'Blueprint';

  const branchQuery = useApiQuery<Subgraph | null>(
    isFeature && selectedRef ? `branch:${orgSlug}:${projectSlug}:${selectedRef}` : 'branch:none',
    () => (isFeature && selectedRef ? getFeatureBranch(orgSlug, projectSlug, selectedRef) : Promise.resolve(null)),
    [orgSlug, projectSlug, selectedRef, isFeature],
    (data) => data === null,
  );
  // WO-458: a Feature's own code refs/commits aren't fetched by id -- they're these same project-wide
  // lists, narrowed in `TraceabilityPanel` to the feature's blueprints (from `branch`).
  const wantsCodeAndCommits = isBlueprint || isFeature;
  const codeRefsQuery = useApiQuery<readonly CodeRefDto[] | null>(
    wantsCodeAndCommits ? `code-refs:${orgSlug}:${projectSlug}` : 'code-refs:none',
    () => (wantsCodeAndCommits ? listCodeRefs(orgSlug, projectSlug) : Promise.resolve(null)),
    [orgSlug, projectSlug, wantsCodeAndCommits],
    (data) => !data || data.length === 0,
  );
  const commitsQuery = useApiQuery<CommitsPage | null>(
    wantsCodeAndCommits ? `commits:${orgSlug}:${projectSlug}` : 'commits:none',
    () => (wantsCodeAndCommits ? listCommits(orgSlug, projectSlug) : Promise.resolve(null)),
    [orgSlug, projectSlug, wantsCodeAndCommits],
    (data) => !data || data.items.length === 0,
  );

  if (treeQuery.status === 'cargando') {
    return (
      <div>
        <PageHeader title="Árbol de features" />
        <Skeleton rows={8} />
      </div>
    );
  }

  if (treeQuery.status === 'error') {
    return (
      <div>
        <PageHeader title="Árbol de features" />
        <ErrorState title="No pudimos cargar el árbol" body={errorMessage(treeQuery.error)} onRetry={treeQuery.retry} />
      </div>
    );
  }

  if (treeQuery.status === 'vacio' || !selectedRef) {
    return (
      <div>
        <PageHeader title="Árbol de features" />
        <EmptyState title="Todavía no hay features" body="Cuando el proyecto tenga al menos una feature, va a aparecer acá." />
      </div>
    );
  }

  const canClose = isFeature && detail !== null && detail !== undefined && detail.node.status !== 'closed' && can(subject, 'close_feature');
  const { total: totalFeatures, closed: closedFeatures } = countFeatures(forest);

  return (
    <div>
      <PageHeader title="Árbol de features" subtitle="De la visión de mercado a cada feature request" />
      <div className={styles.layout}>
        <div className={styles.treeColumn}>
          <div className={styles.treeSearch}>
            <SearchField label="Buscar por id o título" value={searchQuery} onChange={setSearchQuery} placeholder="Buscar por id o título" />
          </div>
          <div className={styles.treeHeaderRow}>
            <span className={styles.treeCount}>
              <span className="num">{totalFeatures}</span> features, <span className="num">{closedFeatures}</span> cerradas
            </span>
            <Button type="button" variant="ghost" onClick={() => setCollapseSignal((value) => value + 1)}>
              Contraer todo
            </Button>
          </div>
          <FeatureTree
            forest={visibleForest}
            selectedRef={selectedRef}
            driftRefs={driftRefs}
            collapseSignal={collapseSignal}
            onSelect={(ref) => navigate(`/o/${orgSlug}/p/${projectSlug}/arbol/${ref}`)}
          />
        </div>
        <div>
          {nodeQuery.status === 'cargando' ? <Skeleton rows={6} /> : null}
          {nodeQuery.status === 'error' ? <ErrorState title="No pudimos cargar el nodo" body={errorMessage(nodeQuery.error)} onRetry={nodeQuery.retry} /> : null}
          {detail ? (
            <TraceabilityPanel
              detail={detail}
              ordersHref={`/o/${orgSlug}/p/${projectSlug}/ordenes`}
              branch={branchQuery.data ?? null}
              codeRefs={codeRefsQuery.data ?? null}
              commits={commitsQuery.data ?? null}
              canClose={canClose}
              onOpenClosure={() => setClosureOpen(true)}
            />
          ) : null}
        </div>
      </div>

      {detail && isFeature ? (
        <ClosureModal
          open={closureOpen}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          featureId={selectedRef}
          featureTitle={detail.node.title}
          onClose={() => setClosureOpen(false)}
          onClosed={() => {
            setClosureOpen(false);
            nodeQuery.retry();
          }}
        />
      ) : null}
    </div>
  );
}
