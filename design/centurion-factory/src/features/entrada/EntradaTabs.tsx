/** EntradaPage's three tabs (Sin triar / Triados / Artifacts) over the shared Tabs primitive. */
import type { ReactElement, ReactNode } from 'react';
import { EmptyState, Tabs, type TabDef, type TabsClassNames } from '../../components';
import type { InboxItem } from '../../data';
import { ArtifactRow } from './ArtifactRow';
import styles from './EntradaPage.module.css';
import { FeedbackRow } from './FeedbackRow';
import { TriagedRow } from './TriagedRow';
import type { TabKey, UseEntradaStateResult } from './useEntradaState';

const TAB_CLASS_NAMES: TabsClassNames = {
  wrapper: '',
  tablist: styles.tabs,
  tab: (selected) => [styles.tab, selected ? styles.tabActive : null].filter(Boolean).join(' '),
  panel: '',
};

interface ListOrEmptyProps {
  readonly items: readonly InboxItem[];
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly renderItem: (item: InboxItem) => ReactNode;
}

function ListOrEmpty({ items, emptyTitle, emptyBody, renderItem }: ListOrEmptyProps): ReactElement {
  if (items.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return <div className={styles.list}>{items.map(renderItem)}</div>;
}

function sinTriarTab(state: UseEntradaStateResult): TabDef {
  return {
    id: 'sin-triar',
    label: (
      <>
        Sin triar <span className="num">({state.sinTriar.length})</span>
      </>
    ),
    panel: (
      <ListOrEmpty
        items={state.sinTriar}
        emptyTitle="Todavía no hay feedback sin triar"
        emptyBody="Lo nuevo llega desde el MCP o la CLI."
        renderItem={(item) => (
          <FeedbackRow
            key={item.id}
            item={item}
            expanded={state.expandedIds.has(item.id)}
            onToggleExpand={() => state.toggleExpand(item.id)}
            onLink={() => state.openLink(item)}
            onCreateFeatureRequest={() => state.openCreate(item)}
          />
        )}
      />
    ),
  };
}

function triadosTab(state: UseEntradaStateResult): TabDef {
  return {
    id: 'triados',
    label: 'Triados',
    panel: (
      <ListOrEmpty
        items={state.triados}
        emptyTitle="Todavía no se trió nada"
        emptyBody="Cuando enlaces o crees una feature request, va a aparecer acá."
        renderItem={(item) => <TriagedRow key={item.id} item={item} />}
      />
    ),
  };
}

function artifactsTab(state: UseEntradaStateResult): TabDef {
  return {
    id: 'artifacts',
    label: 'Artifacts',
    panel: (
      <ListOrEmpty
        items={state.artifacts}
        emptyTitle="Todavía no hay artifacts"
        emptyBody="Las grabaciones y notas de contexto van a aparecer acá."
        renderItem={(item) => <ArtifactRow key={item.id} item={item} />}
      />
    ),
  };
}

function buildTabs(state: UseEntradaStateResult): readonly TabDef[] {
  return [sinTriarTab(state), triadosTab(state), artifactsTab(state)];
}

export interface EntradaTabsProps {
  readonly state: UseEntradaStateResult;
}

export function EntradaTabs({ state }: EntradaTabsProps): ReactElement {
  return (
    <Tabs
      ariaLabel="Bandeja de entrada"
      idPrefix="entrada"
      activeId={state.tab}
      onChange={(id) => state.setTab(id as TabKey)}
      tabs={buildTabs(state)}
      classNames={TAB_CLASS_NAMES}
    />
  );
}
