/**
 * `/o/:orgSlug/p/:projectSlug/arbol/:id?` (Centurion Factory "Árbol de features", SDD-012, WO-355): a
 * keyboard-navigable ARIA tree of the project's documents (`getTree`) plus a traceability panel for the
 * selected node (`getNode`, and `getFeatureBranch`/`listCodeRefs`/`listCommits` for richer counts) and the
 * "Cerrar feature" confirmation modal (`getClosureReadiness`/`closeFeature`). See canvas/Arbol.dc.html.
 * Deliberately drops `@prdm/ui`'s `GraphCanvas`/`TreeView`/`NodeDetailPanel` (Stark HUD tokens, not this
 * design's) — every style here comes from `src/styles/tokens.css` instead.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CodeRefDto, CommitDto } from '@prdm/contracts';
import { can } from '@prdm/contracts';
import type { NodeDetail, NodeLink, NodeView, Subgraph, TreeNode } from '@prdm/core';
import type { ClosureCheck, ClosureReadiness } from '@prdm/core';
import {
  closeFeature,
  getClosureReadiness,
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
  EmptyState,
  ErrorState,
  IdTag,
  Modal,
  PageHeader,
  Skeleton,
  StatusBadge,
  type StatusBadgeFeatureStatus,
  type StatusBadgeWorkOrderStatus,
  type StatusBadgeWorkflowStatus,
} from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';

const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
const FEATURE_STATUSES = new Set<StatusBadgeFeatureStatus>(['draft', 'proposed', 'approved', 'closed']);
const WORK_ORDER_STATUSES = new Set<StatusBadgeWorkOrderStatus>(['pending', 'in_progress', 'out_of_sync', 'done']);
const WORKFLOW_STATUSES = new Set<StatusBadgeWorkflowStatus>(['draft', 'in_review', 'published', 'archived']);

// --- Pure tree helpers (no React), operating directly on @prdm/core's already-nested TreeNode ---

interface VisibleRow {
  readonly node: TreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly setSize: number;
  readonly posInSet: number;
}

function flattenVisible(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, depth = 0): readonly VisibleRow[] {
  return nodes.flatMap((node, index) => {
    const row: VisibleRow = { node, depth, hasChildren: node.children.length > 0, setSize: nodes.length, posInSet: index + 1 };
    const isExpanded = node.children.length === 0 || expanded.has(node.ref);
    return isExpanded ? [row, ...flattenVisible(node.children, expanded, depth + 1)] : [row];
  });
}

function collectExpandableRefs(nodes: readonly TreeNode[]): readonly string[] {
  return nodes.flatMap((node) => (node.children.length > 0 ? [node.ref, ...collectExpandableRefs(node.children)] : []));
}

function buildParentIndex(nodes: readonly TreeNode[], parentRef: string | undefined, index: Map<string, string | undefined>): void {
  for (const node of nodes) {
    index.set(node.ref, parentRef);
    buildParentIndex(node.children, node.ref, index);
  }
}

interface TreeKeyboardMove {
  readonly nextFocusedRef: string;
  readonly nextExpanded?: ReadonlySet<string>;
}

function applyTreeKeyboardMove(key: string, focusedRef: string, forest: readonly TreeNode[], expanded: ReadonlySet<string>): TreeKeyboardMove | undefined {
  const rows = flattenVisible(forest, expanded);
  const refs = rows.map((row) => row.node.ref);
  const index = refs.indexOf(focusedRef);
  if (index === -1) return undefined;

  if (key === 'ArrowDown') return refs[index + 1] ? { nextFocusedRef: refs[index + 1]! } : undefined;
  if (key === 'ArrowUp') return refs[index - 1] ? { nextFocusedRef: refs[index - 1]! } : undefined;
  if (key === 'Home') return refs[0] ? { nextFocusedRef: refs[0]! } : undefined;
  if (key === 'End') return refs[refs.length - 1] ? { nextFocusedRef: refs[refs.length - 1]! } : undefined;

  if (key === 'ArrowRight') {
    const row = rows[index];
    if (!row?.hasChildren) return undefined;
    if (!expanded.has(focusedRef)) return { nextFocusedRef: focusedRef, nextExpanded: new Set([...expanded, focusedRef]) };
    const firstChildRef = row.node.children[0]?.ref;
    return firstChildRef ? { nextFocusedRef: firstChildRef } : undefined;
  }

  if (key === 'ArrowLeft') {
    if (expanded.has(focusedRef)) {
      const next = new Set(expanded);
      next.delete(focusedRef);
      return { nextFocusedRef: focusedRef, nextExpanded: next };
    }
    const parents = new Map<string, string | undefined>();
    buildParentIndex(forest, undefined, parents);
    const parentRef = parents.get(focusedRef);
    return parentRef ? { nextFocusedRef: parentRef } : undefined;
  }

  return undefined;
}

function relatedRefs(links: readonly NodeLink[], type: string, direction: 'in' | 'out'): readonly NodeLink[] {
  return links.filter((link) => link.type === type && link.direction === direction);
}

// --- FeatureTree: the left ARIA tree ---

interface FeatureTreeProps {
  readonly forest: readonly TreeNode[];
  readonly selectedRef: string;
  readonly onSelect: (ref: string) => void;
}

function FeatureTree({ forest, selectedRef, onSelect }: FeatureTreeProps): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(collectExpandableRefs(forest)));
  const [focusedRef, setFocusedRef] = useState(selectedRef);
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => setFocusedRef(selectedRef), [selectedRef]);

  useEffect(() => {
    treeRef.current?.querySelector<HTMLDivElement>(`[data-ref="${CSS.escape(focusedRef)}"]`)?.focus();
  }, [focusedRef]);

  const rows = useMemo(() => flattenVisible(forest, expanded), [forest, expanded]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(focusedRef);
      return;
    }
    if (!MOVE_KEYS.has(event.key)) return;
    event.preventDefault();
    const result = applyTreeKeyboardMove(event.key, focusedRef, forest, expanded);
    if (!result) return;
    if (result.nextExpanded) setExpanded(result.nextExpanded);
    setFocusedRef(result.nextFocusedRef);
  }

  return (
    <div ref={treeRef} role="tree" aria-label="Árbol de features" onKeyDown={handleKeyDown} style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((row) => {
        const isSelected = row.node.ref === selectedRef;
        const isClosed = row.node.status === 'closed';
        return (
          <div
            key={row.node.ref}
            data-ref={row.node.ref}
            role="treeitem"
            tabIndex={row.node.ref === focusedRef ? 0 : -1}
            aria-selected={isSelected}
            aria-expanded={row.hasChildren ? expanded.has(row.node.ref) : undefined}
            aria-level={row.depth + 1}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            onClick={() => onSelect(row.node.ref)}
            onFocus={() => setFocusedRef(row.node.ref)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 36,
              paddingLeft: 8 + row.depth * 20,
              borderRadius: 2,
              cursor: 'pointer',
              opacity: isClosed && !isSelected ? 0.6 : 1,
              background: isSelected ? 'var(--superficie)' : undefined,
              outline: isSelected ? '2px solid var(--cianotipo)' : undefined,
              outlineOffset: isSelected ? -2 : undefined,
            }}
          >
            <span className="id" style={{ color: 'var(--apagado)' }}>
              {row.node.ref}
            </span>
            <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.node.title}</span>
          </div>
        );
      })}
    </div>
  );
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
  return <span style={{ fontSize: 14, color: 'var(--apagado)' }}>{view.status}</span>;
}

interface TraceabilityPanelProps {
  readonly detail: NodeDetail;
  readonly branch: Subgraph | null;
  readonly codeRefs: readonly CodeRefDto[] | null;
  readonly commits: CommitsPage | null;
  readonly canClose: boolean;
  readonly onOpenClosure: () => void;
}

function TraceabilityPanel({ detail, branch, codeRefs, commits, canClose, onOpenClosure }: TraceabilityPanelProps): ReactElement {
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

  const relatedCodeRefs = codeRefs?.filter((ref) => ref.blueprintId === view.id) ?? [];
  const relatedCommits = commits?.items.filter((commit) => commit.refs.includes(view.id)) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IdTag id={view.id} />
            {renderStatus(view)}
          </div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>{view.title}</h2>
          {parent ? (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--apagado)' }}>
              Hija de <IdTag id={parent.ref} />
            </p>
          ) : null}
          {architects ? (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--apagado)' }}>
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
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Trazabilidad</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, margin: 0 }}>
          {origin.length > 0 ? (
            <div>
              <dt style={{ fontSize: 14, color: 'var(--apagado)' }}>Origen</dt>
              <dd style={{ margin: 0 }}>{origin.map((link) => link.ref).join(', ')}</dd>
            </div>
          ) : null}
          {children.length > 0 ? (
            <div>
              <dt style={{ fontSize: 14, color: 'var(--apagado)' }}>Features hijas</dt>
              <dd style={{ margin: 0 }}>{children.map((link) => link.ref).join(', ')}</dd>
            </div>
          ) : null}
          {blueprintsIn.length > 0 || branch ? (
            <div>
              <dt style={{ fontSize: 14, color: 'var(--apagado)' }}>Blueprints</dt>
              <dd className="num" style={{ margin: 0, fontWeight: 600 }}>
                {branch ? branchBlueprints.length : blueprintsIn.length}
              </dd>
            </div>
          ) : null}
          {workOrdersIn.length > 0 || branch ? (
            <div>
              <dt style={{ fontSize: 14, color: 'var(--apagado)' }}>Órdenes</dt>
              <dd className="num" style={{ margin: 0, fontWeight: 600 }}>
                {branch ? `${doneWorkOrders} de ${branchWorkOrders.length} hechas` : workOrdersIn.length}
              </dd>
            </div>
          ) : null}
          {codeRefs ? (
            <div>
              <dt style={{ fontSize: 14, color: 'var(--apagado)' }}>Código</dt>
              <dd className="num" style={{ margin: 0, fontWeight: 600, color: 'var(--senal-texto)' }}>
                {relatedCodeRefs.length} {relatedCodeRefs.length === 1 ? 'referencia' : 'referencias'}
              </dd>
            </div>
          ) : null}
          {commits ? (
            <div>
              <dt style={{ fontSize: 14, color: 'var(--apagado)' }}>Commits</dt>
              <dd className="num" style={{ margin: 0, fontWeight: 600 }}>
                {relatedCommits.length} {relatedCommits.length === 1 ? 'commit' : 'commits'}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}

// --- ClosureModal: the "Cerrar feature" confirmation ---

function CheckRow({ check }: { readonly check: ClosureCheck }): ReactElement {
  return (
    <li style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--regla-fila)' }}>
      <span aria-hidden="true" style={{ flex: 'none', color: check.ok ? 'var(--senal)' : 'var(--paro)' }}>
        {check.ok ? '✓' : '✗'}
      </span>
      <span style={{ fontSize: 14, color: check.ok ? 'var(--texto-secundario)' : 'var(--paro)' }}>{check.detail}</span>
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
    <Modal open={open} title="Cerrar feature" description={`${featureId} ${featureTitle}`} onClose={onClose}
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
          <p style={{ fontSize: 14, color: 'var(--apagado)' }}>
            {passCount} de {readiness.checks.length} checks pasan
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
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
  useDocumentTitle('Árbol de features');

  const treeQuery = useApiQuery(
    `tree:${orgSlug}:${projectSlug}`,
    () => getTree(orgSlug, projectSlug).then((response) => response.forest),
    [orgSlug, projectSlug],
    (forest) => forest.length === 0,
  );
  const forest = treeQuery.data ?? [];
  const selectedRef = id ?? forest[0]?.ref;

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
  const codeRefsQuery = useApiQuery<readonly CodeRefDto[] | null>(
    isBlueprint ? `code-refs:${orgSlug}:${projectSlug}` : 'code-refs:none',
    () => (isBlueprint ? listCodeRefs(orgSlug, projectSlug) : Promise.resolve(null)),
    [orgSlug, projectSlug, isBlueprint],
    (data) => !data || data.length === 0,
  );
  const commitsQuery = useApiQuery<CommitsPage | null>(
    isBlueprint ? `commits:${orgSlug}:${projectSlug}` : 'commits:none',
    () => (isBlueprint ? listCommits(orgSlug, projectSlug) : Promise.resolve(null)),
    [orgSlug, projectSlug, isBlueprint],
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

  return (
    <div>
      <PageHeader title="Árbol de features" subtitle="De la visión de mercado a cada feature request" />
      <div style={{ display: 'grid', gridTemplateColumns: '420px minmax(0, 1fr)', gap: 32, borderTop: '1px solid var(--regla)', paddingTop: 16 }}>
        <FeatureTree forest={forest} selectedRef={selectedRef} onSelect={(ref) => navigate(`/o/${orgSlug}/p/${projectSlug}/arbol/${ref}`)} />
        <div>
          {nodeQuery.status === 'cargando' ? <Skeleton rows={6} /> : null}
          {nodeQuery.status === 'error' ? <ErrorState title="No pudimos cargar el nodo" body={errorMessage(nodeQuery.error)} onRetry={nodeQuery.retry} /> : null}
          {detail ? (
            <TraceabilityPanel
              detail={detail}
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
