/**
 * Sample work orders (WO-270): the FR-002 / SDD-012 importer set exactly as specified in the
 * canvas brief. All `sample: true`. The rest of the filler orders live in workOrdersFiller.ts to
 * keep every data file under the 400-line budget.
 *
 * FR-002's true progress (14 done of 22, 3 stopped) is bigger than these 6 representative rows —
 * see FEATURE_PROGRESS_OVERRIDES in workOrders.ts.
 */
import type { WorkOrder } from './types';

export const FR002_WORK_ORDERS: readonly WorkOrder[] = [
  {
    id: 'WO-301',
    title: 'Tabla de hashes por archivo en Postgres',
    status: 'done',
    blueprintId: 'SDD-012',
    featureId: 'FR-002',
    assignedTo: 'agent:claude',
    objective: 'Registrar el hash de cada archivo importado en una tabla de Postgres para poder comparar escaneos sucesivos.',
    criteria: [
      { text: 'La tabla guarda el hash, el tamaño y la fecha de la última importación por archivo', done: true },
      { text: 'Un segundo escaneo del mismo repo no reinserta filas ya existentes', done: true },
      { text: 'Commit con el trailer Refs: WO-301', done: true },
    ],
    governedPaths: ['packages/db/migrations/0031_import_file_hashes.sql', 'packages/server/src/import/hash-table.ts'],
    commitShas: ['f2a3b4c'],
    updatedAt: '2026-09-12T16:00:00.000Z',
    claimedAt: '2026-09-12T10:00:00.000Z',
    completedAt: '2026-09-12T16:00:00.000Z',
    sample: true,
  },
  {
    id: 'WO-302',
    title: 'Detección de archivos borrados',
    status: 'done',
    blueprintId: 'SDD-012',
    featureId: 'FR-002',
    assignedTo: 'agent:deepseek',
    objective: 'Detectar y marcar los archivos que existían en el escaneo anterior y ya no están en el repo.',
    criteria: [
      { text: 'Un archivo ausente en el escaneo actual queda marcado como borrado, no eliminado de la tabla', done: true },
      { text: 'El resumen del importador cuenta los archivos borrados por separado', done: true },
      { text: 'Commit con el trailer Refs: WO-302', done: true },
    ],
    governedPaths: ['packages/server/src/import/hash-table.ts'],
    commitShas: ['a3b4c5d'],
    updatedAt: '2026-09-11T15:30:00.000Z',
    claimedAt: '2026-09-11T10:00:00.000Z',
    completedAt: '2026-09-11T15:30:00.000Z',
    sample: true,
  },
  {
    id: 'WO-304',
    title: 'Escaneo incremental por hash de archivo',
    status: 'in_progress',
    blueprintId: 'SDD-012',
    featureId: 'FR-002',
    assignedTo: 'agent:claude',
    objective: 'Escanear el repo comparando el hash de cada archivo contra la tabla, sin releer archivos sin cambios.',
    criteria: [
      { text: 'Un archivo con el mismo hash que la última importación no se vuelve a subir', done: false },
      { text: 'El escaneo reporta cuántos archivos se saltó por no haber cambiado', done: false },
      { text: 'Commit con el trailer Refs: WO-304', done: false },
    ],
    governedPaths: ['packages/server/src/import/scan.ts'],
    commitShas: [],
    updatedAt: '2026-09-15T09:56:00.000Z',
    claimedAt: '2026-09-15T08:30:00.000Z',
    sample: true,
  },
  {
    id: 'WO-307',
    title: 'Reintento de subida con idempotencia',
    status: 'in_progress',
    blueprintId: 'SDD-012',
    featureId: 'FR-002',
    assignedTo: 'dev:martin',
    objective: 'Reintentar la subida de un archivo importado sin duplicarlo si la respuesta anterior se perdió.',
    criteria: [
      { text: 'Reintentar con la misma clave de idempotencia no crea una segunda copia del archivo', done: false },
      { text: 'Un reintento tras un timeout completa la subida sin intervención manual', done: false },
      { text: 'Commit con el trailer Refs: WO-307', done: false },
    ],
    governedPaths: ['packages/server/src/import/scan.ts'],
    commitShas: [],
    updatedAt: '2026-09-15T09:22:00.000Z',
    claimedAt: '2026-09-15T07:00:00.000Z',
    sample: true,
  },
  {
    id: 'WO-310',
    title: 'Resumen del importador en la CLI',
    status: 'out_of_sync',
    blueprintId: 'SDD-012',
    featureId: 'FR-002',
    assignedTo: 'agent:claude',
    objective:
      'Al terminar una importación, la CLI muestra cuántos archivos entraron nuevos, cambiaron, se borraron o se omitieron, y cuánto tardó el escaneo.',
    criteria: [
      { text: 'El resumen separa archivos nuevos, modificados, borrados y omitidos', done: true },
      { text: 'Los conteos coinciden con la tabla de hashes que define SDD-012', done: false },
      { text: 'Commit con el trailer Refs: WO-310', done: false },
    ],
    governedPaths: ['packages/cli/src/commands/import.ts', 'packages/server/src/import/scan.ts'],
    commitShas: ['3c1a5af'],
    updatedAt: '2026-09-15T09:48:00.000Z',
    claimedAt: '2026-09-14T18:00:00.000Z',
    outOfSyncReason: 'SDD-012 cambió el 15/09 a las 10:02. Revisá los criterios antes de retomar.',
    sample: true,
  },
  {
    id: 'WO-311',
    title: 'Test de importación de 2.000 documentos',
    status: 'pending',
    blueprintId: 'SDD-012',
    featureId: 'FR-002',
    objective: 'Verificar que el importador soporta un repo grande sin degradar el tiempo de escaneo.',
    criteria: [
      { text: 'Importar 2.000 documentos de ejemplo termina en menos de 10 minutos', done: false },
      { text: 'El uso de memoria no crece de forma lineal con la cantidad de documentos', done: false },
      { text: 'Commit con el trailer Refs: WO-311', done: false },
    ],
    governedPaths: ['packages/server/tests/import/large-repo.test.ts'],
    commitShas: [],
    updatedAt: '2026-09-15T08:00:00.000Z',
    sample: true,
  },
];
