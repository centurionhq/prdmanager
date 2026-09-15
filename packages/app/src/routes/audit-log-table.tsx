/**
 * Shared presentational table for both the project and organization audit-log screens (SDD-013
 * §"Shell y router"), built on the ported `DataTable` (WO-348).
 */
import type { ReactElement } from 'react';
import type { AuditLogEntryDto } from '@prdm/contracts';
import { DataTable, type DataTableColumn } from '../components/index.js';

const COLUMNS: readonly DataTableColumn<AuditLogEntryDto>[] = [
  { key: 'createdAt', header: 'Cuándo', render: (row) => new Date(row.createdAt).toLocaleString('es-AR'), sortValue: (row) => row.createdAt },
  { key: 'actor', header: 'Quién', render: (row) => `${row.actor.type}:${row.actor.id}` },
  { key: 'action', header: 'Acción', render: (row) => row.action },
  { key: 'target', header: 'Objetivo', render: (row) => row.target },
];

export function AuditLogTable({ items }: { readonly items: readonly AuditLogEntryDto[] }): ReactElement {
  return <DataTable caption="Registro de auditoría" columns={COLUMNS} rows={items} getRowId={(row) => row.id} />;
}
