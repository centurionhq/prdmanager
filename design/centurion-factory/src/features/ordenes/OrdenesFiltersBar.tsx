import { ChevronDown } from 'lucide-react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { FilterChips } from '../../components';
import type { Blueprint } from '../../data';
import styles from './OrdenesFiltersBar.module.css';
import { ASSIGNEE_FILTERS, DEFAULT_BLUEPRINT_FILTER, STATUS_FILTERS, type AssigneeFilterKey, type StatusFilterKey } from './filters';

export interface OrdenesFiltersBarProps {
  readonly status: StatusFilterKey;
  readonly onStatusChange: (value: StatusFilterKey) => void;
  readonly counts: Readonly<Record<StatusFilterKey, number>>;
  readonly blueprintId: string;
  readonly onBlueprintChange: (value: string) => void;
  readonly blueprints: readonly Blueprint[];
  readonly assignee: AssigneeFilterKey;
  readonly onAssigneeChange: (value: AssigneeFilterKey) => void;
}

/** Selects share the same look: surface plate, rule border, a trailing chevron. */
function PlateSelect<T extends string>({
  label,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly children: ReactNode;
}): ReactElement {
  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    onChange(event.target.value as T);
  }

  return (
    <div className={styles.selectWrapper}>
      <select aria-label={label} className={styles.select} value={value} onChange={handleChange}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" size={16} className={styles.selectIcon} />
    </div>
  );
}

/** The status chips and the Blueprint / Asignada a selects atop the Órdenes de trabajo table. */
export function OrdenesFiltersBar({
  status,
  onStatusChange,
  counts,
  blueprintId,
  onBlueprintChange,
  blueprints,
  assignee,
  onAssigneeChange,
}: OrdenesFiltersBarProps): ReactElement {
  return (
    <div className={styles.bar}>
      <FilterChips
        label="Estado"
        value={status}
        onChange={(value) => onStatusChange(value as StatusFilterKey)}
        options={STATUS_FILTERS.map((option) => ({ value: option.key, label: option.label, count: counts[option.key] }))}
      />
      <div className={styles.selects}>
        <PlateSelect label="Blueprint" value={blueprintId} onChange={onBlueprintChange}>
          <option value={DEFAULT_BLUEPRINT_FILTER}>Blueprint: todos</option>
          {blueprints.map((blueprint) => (
            <option key={blueprint.id} value={blueprint.id}>
              Blueprint: {blueprint.id}
            </option>
          ))}
        </PlateSelect>
        <PlateSelect label="Asignada a" value={assignee} onChange={onAssigneeChange}>
          {ASSIGNEE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </PlateSelect>
      </div>
    </div>
  );
}
