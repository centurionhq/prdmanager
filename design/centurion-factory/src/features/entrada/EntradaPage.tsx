import { useId, useState, type ReactElement } from 'react';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '../../components';
import { FEATURES, INBOX_ITEMS, type InboxItem } from '../../data';
import { useDemoState } from '../../lib/use-demo-state';
import { CreateFeatureRequestModal } from './CreateFeatureRequestModal';
import styles from './EntradaPage.module.css';
import { FeedbackRow } from './FeedbackRow';
import { nextFeatureRequestId, nextFeedbackId } from './lib';
import { LinkFeatureModal } from './LinkFeatureModal';
import { RegisterFeedbackModal, type RegisterFeedbackInput } from './RegisterFeedbackModal';
import { TriagedRow } from './TriagedRow';
import { ArtifactRow } from './ArtifactRow';

type TabKey = 'sin-triar' | 'triados' | 'artifacts';

const TABS: readonly { readonly key: TabKey; readonly label: string }[] = [
  { key: 'sin-triar', label: 'Sin triar' },
  { key: 'triados', label: 'Triados' },
  { key: 'artifacts', label: 'Artifacts' },
];

/** Bandeja de entrada: triage feedback into features, or leave it as reference (WO-295). */
export function EntradaPage(): ReactElement {
  const { state, retry } = useDemoState();
  const { show } = useToast();
  const tabIdBase = useId();

  const [items, setItems] = useState<readonly InboxItem[]>(INBOX_ITEMS);
  const [createdFeatureIds, setCreatedFeatureIds] = useState<readonly string[]>([]);
  const [tab, setTab] = useState<TabKey>('sin-triar');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [registerOpen, setRegisterOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<InboxItem | undefined>(undefined);
  const [linkOpen, setLinkOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<InboxItem | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);

  const feedback = items.filter((item) => item.kind === 'FB');
  const sinTriar = feedback.filter((item) => item.status === 'new');
  const triados = feedback.filter((item) => item.status === 'triaged');
  const artifacts = items.filter((item) => item.kind === 'ART');

  function toggleExpand(id: string): void {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openLink(item: InboxItem): void {
    setLinkTarget(item);
    setLinkOpen(true);
  }

  function openCreate(item: InboxItem): void {
    setCreateTarget(item);
    setCreateOpen(true);
  }

  function handleLinkConfirm(featureId: string): void {
    if (!linkTarget) return;
    setItems((previous) => previous.map((item) => (item.id === linkTarget.id ? { ...item, status: 'triaged', links: [featureId] } : item)));
    setLinkOpen(false);
    show(`Feedback enlazado a ${featureId}`, { tone: 'success' });
  }

  function handleCreateConfirm({ parentFeatureId }: { readonly title: string; readonly parentFeatureId: string }): void {
    if (!createTarget) return;
    const featureRequestId = nextFeatureRequestId([...FEATURES.map((feature) => feature.id), ...createdFeatureIds]);
    setCreatedFeatureIds((previous) => [...previous, featureRequestId]);
    setItems((previous) =>
      previous.map((item) => (item.id === createTarget.id ? { ...item, status: 'triaged', links: [featureRequestId] } : item)),
    );
    setCreateOpen(false);
    show(`Feature request ${featureRequestId} creada`, { tone: 'success' });
    void parentFeatureId; // recorded only in the demo's local state, not rendered elsewhere yet
  }

  function handleRegisterConfirm(input: RegisterFeedbackInput): void {
    const id = nextFeedbackId(items);
    const newItem: InboxItem = {
      id,
      kind: 'FB',
      title: input.title,
      body: input.body,
      source: input.source,
      status: 'new',
      links: [],
      receivedAt: new Date().toISOString(),
      candidates: [],
      sample: true,
    };
    setItems((previous) => [newItem, ...previous]);
    setRegisterOpen(false);
    show('Feedback registrado', { tone: 'success' });
  }

  const tabPanelId = (key: TabKey) => `${tabIdBase}-panel-${key}`;
  const tabId = (key: TabKey) => `${tabIdBase}-tab-${key}`;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Bandeja de entrada"
        subtitle="Feedback y artifacts que todavía no justifican una feature"
        actions={
          <Button type="button" variant="secondary" onClick={() => setRegisterOpen(true)}>
            Registrar feedback
          </Button>
        }
      />

      {state === 'cargando' ? <Skeleton rows={6} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar la bandeja" body="Algo falló al traer el feedback. Volvé a intentarlo." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState title="Todavía no hay feedback ni artifacts" body="Lo nuevo llega desde el MCP o la CLI." />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.layout}>
          <div className={styles.main}>
            <div role="tablist" aria-label="Bandeja de entrada" className={styles.tabs}>
              {TABS.map((option) => (
                <button
                  key={option.key}
                  id={tabId(option.key)}
                  type="button"
                  role="tab"
                  aria-selected={tab === option.key}
                  aria-controls={tabPanelId(option.key)}
                  className={[styles.tab, tab === option.key ? styles.tabActive : null].filter(Boolean).join(' ')}
                  onClick={() => setTab(option.key)}
                >
                  {option.label}
                  {option.key === 'sin-triar' ? <span className="num"> ({sinTriar.length})</span> : null}
                </button>
              ))}
            </div>

            <div id={tabPanelId('sin-triar')} role="tabpanel" aria-labelledby={tabId('sin-triar')} hidden={tab !== 'sin-triar'}>
              {sinTriar.length === 0 ? (
                <EmptyState title="Todavía no hay feedback sin triar" body="Lo nuevo llega desde el MCP o la CLI." />
              ) : (
                <div className={styles.list}>
                  {sinTriar.map((item) => (
                    <FeedbackRow
                      key={item.id}
                      item={item}
                      expanded={expandedIds.has(item.id)}
                      onToggleExpand={() => toggleExpand(item.id)}
                      onLink={() => openLink(item)}
                      onCreateFeatureRequest={() => openCreate(item)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div id={tabPanelId('triados')} role="tabpanel" aria-labelledby={tabId('triados')} hidden={tab !== 'triados'}>
              {triados.length === 0 ? (
                <EmptyState title="Todavía no se trió nada" body="Cuando enlaces o crees una feature request, va a aparecer acá." />
              ) : (
                <div className={styles.list}>
                  {triados.map((item) => (
                    <TriagedRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>

            <div id={tabPanelId('artifacts')} role="tabpanel" aria-labelledby={tabId('artifacts')} hidden={tab !== 'artifacts'}>
              {artifacts.length === 0 ? (
                <EmptyState title="Todavía no hay artifacts" body="Las grabaciones y notas de contexto van a aparecer acá." />
              ) : (
                <div className={styles.list}>
                  {artifacts.map((item) => (
                    <ArtifactRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className={styles.aside}>
            <h2 className={styles.asideTitle}>Cómo llega lo nuevo</h2>
            <p className={styles.asideText}>
              Los asistentes lo registran por MCP con <span className="id">submit_feedback</span> mientras trabajan.
            </p>
            <p className={styles.asideText}>
              Desde la terminal, cualquier persona del equipo corre <span className="id">prdm feedback add</span>.
            </p>
          </aside>
        </div>
      ) : null}

      <RegisterFeedbackModal open={registerOpen} onClose={() => setRegisterOpen(false)} onConfirm={handleRegisterConfirm} />
      <LinkFeatureModal open={linkOpen} item={linkTarget} onClose={() => setLinkOpen(false)} onConfirm={handleLinkConfirm} />
      <CreateFeatureRequestModal
        open={createOpen}
        item={createTarget}
        features={FEATURES}
        onClose={() => setCreateOpen(false)}
        onConfirm={handleCreateConfirm}
      />
    </div>
  );
}
