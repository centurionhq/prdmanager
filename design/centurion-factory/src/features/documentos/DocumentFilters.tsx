/**
 * Kind chips plus the workflow-state select for the Documentos list (WO-286). No shared Select
 * component exists yet, so this is a local native `<select>` styled to match the canvas control.
 */
import { useId, type ChangeEvent, type ReactElement } from 'react';
import { FilterChips } from '../../components';
import type { WorkflowState } from '../../data';
import styles from './DocumentosPage.module.css';
import { DOCUMENT_KINDS, WORKFLOW_STATES, kindLabel, workflowLabel, type ListedDocumentKind } from './helpers';

export type KindFilterValue = 'all' | ListedDocumentKind;
export type WorkflowFilterValue = 'all' | WorkflowState;

export interface DocumentFiltersProps {
  readonly kindFilter: KindFilterValue;
  readonly onKindFilterChange: (value: KindFilterValue) => void;
  readonly workflowFilter: WorkflowFilterValue;
  readonly onWorkflowFilterChange: (value: WorkflowFilterValue) => void;
}

const KIND_OPTIONS = [{ value: 'all', label: 'Todos' }, ...DOCUMENT_KINDS.map((kind) => ({ value: kind, label: kind }))];

export function DocumentFilters({
  kindFilter,
  onKindFilterChange,
  workflowFilter,
  onWorkflowFilterChange,
}: DocumentFiltersProps): ReactElement {
  const selectId = useId();

  function handleWorkflowChange(event: ChangeEvent<HTMLSelectElement>): void {
    onWorkflowFilterChange(event.target.value as WorkflowFilterValue);
  }

  return (
    <section className={styles.filters}>
      <FilterChips
        label="Tipo de documento"
        options={KIND_OPTIONS}
        value={kindFilter}
        onChange={(value) => onKindFilterChange(value as KindFilterValue)}
      />
      <label className={styles.workflowSelectWrapper} htmlFor={selectId}>
        <span className="visually-hidden">Estado de flujo</span>
        <select id={selectId} className={styles.workflowSelect} value={workflowFilter} onChange={handleWorkflowChange}>
          <option value="all">Todos los estados</option>
          {WORKFLOW_STATES.map((state) => (
            <option key={state} value={state}>
              {workflowLabel(state)}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
