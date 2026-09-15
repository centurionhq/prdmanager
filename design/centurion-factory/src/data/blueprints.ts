/**
 * Blueprint mock data (WO-270).
 *
 * SDD-001..011 and ADR-002/004/006/007 are the real blueprints of the prdmanager graph (see
 * docs/sdd, docs/adr): titles, architects (the feature each one designs) and impactsPaths are
 * taken from their frontmatter, trimmed to a representative subset so this file stays under the
 * 400-line budget. ADR-001/003/005 are deliberately left out to keep the count at 16 with one
 * sample blueprint added; dropping them does not change any invariant this package tests.
 *
 * SDD-012 "Importador incremental por hash" is the sample blueprint for the sample feature
 * FR-002, changed on 15/09 at 10:02 — the event that strands WO-310 (`out_of_sync`).
 */
import type { Blueprint } from './types';

export const BLUEPRINTS: readonly Blueprint[] = [
  {
    id: 'SDD-001',
    kind: 'SDD',
    title: 'Arquitectura del Product & Context Graph Engine',
    status: 'active',
    architects: ['PRD-001'],
    impactsPaths: ['packages/core/src/domain/**', 'packages/core/src/graph/**', 'packages/core/src/engine.ts'],
    changedAt: '2026-09-12',
    sample: false,
  },
  {
    id: 'SDD-002',
    kind: 'SDD',
    title: 'Motor headless multi-proyecto con autoría conversacional',
    status: 'active',
    architects: ['PRD-002'],
    impactsPaths: ['packages/core/src/**', 'packages/cli/src/**', 'packages/mcp/src/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-003',
    kind: 'SDD',
    title: 'Persistencia stateful de borradores en @prdm/core',
    status: 'active',
    architects: ['FR-001'],
    impactsPaths: ['packages/core/src/authoring/**', 'packages/mcp/src/server.ts'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-004',
    kind: 'SDD',
    title: 'Extracción de símbolos con Tree-sitter',
    status: 'active',
    architects: ['PRD-003'],
    impactsPaths: ['packages/core/src/sync/code-refs.ts', 'packages/core/src/sync/tree-sitter-extractor.ts'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-005',
    kind: 'SDD',
    title: 'Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape',
    status: 'active',
    architects: ['PRD-004'],
    impactsPaths: ['packages/web/src/**', 'packages/web/tests/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-006',
    kind: 'SDD',
    title: 'Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard',
    status: 'active',
    architects: ['PRD-005'],
    impactsPaths: ['packages/server/src/**', 'packages/db/src/**', 'packages/app/src/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-007',
    kind: 'SDD',
    title: 'Puerto ProjectEngine y documentos del SaaS sobre Postgres',
    status: 'active',
    architects: ['PRD-005'],
    impactsPaths: ['packages/core/src/**', 'packages/server/src/**', 'packages/contracts/src/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-008',
    kind: 'SDD',
    title: 'Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios',
    status: 'active',
    architects: ['PRD-005'],
    impactsPaths: ['packages/collab/src/**', 'packages/server/src/**', 'packages/app/src/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-009',
    kind: 'SDD',
    title: 'Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas',
    status: 'active',
    architects: ['PRD-005'],
    impactsPaths: ['packages/server/src/**', 'packages/collab/src/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-010',
    kind: 'SDD',
    title: 'MCP remoto, sync de developers e importador',
    status: 'active',
    architects: ['PRD-005'],
    impactsPaths: ['packages/server/src/**', 'packages/mcp/src/**', 'packages/cli/src/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'SDD-011',
    kind: 'SDD',
    title: 'Frontend de diseño de Centurion Factory: tokens, shell, pantallas y datos mock',
    status: 'active',
    architects: ['PRD-006', 'FR-005'],
    impactsPaths: ['design/centurion-factory/src/**', 'design/centurion-factory/tests/**'],
    changedAt: '2026-09-15',
    sample: false,
  },
  {
    id: 'ADR-002',
    kind: 'ADR',
    title: 'Aislamiento multi-proyecto, monorepo y commit atómico',
    status: 'active',
    architects: ['PRD-002'],
    impactsPaths: ['packages/core/src/graph/migrations*.ts', 'docs/model/**'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'ADR-004',
    kind: 'ADR',
    title: 'Stack del explorador web: Fastify + Vite + React + Cytoscape',
    status: 'active',
    architects: ['PRD-004'],
    impactsPaths: ['packages/web/package.json', 'packages/web/vite.config.ts'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'ADR-006',
    kind: 'ADR',
    title: 'Stack de la plataforma SaaS: Postgres + better-auth + Hocuspocus/Yjs + CodeMirror + DeepSeek',
    status: 'active',
    architects: ['PRD-005'],
    impactsPaths: ['packages/server/*.json', 'package.json'],
    changedAt: '2026-09-13',
    sample: false,
  },
  {
    id: 'ADR-007',
    kind: 'ADR',
    title: 'Paquete de diseño aislado: CSS Modules + tokens, fuentes self-hosted, fuera de workspaces',
    status: 'active',
    architects: ['PRD-006'],
    impactsPaths: ['design/centurion-factory/*.json', 'design/centurion-factory/src/styles/**'],
    changedAt: '2026-09-15',
    sample: false,
  },
  {
    id: 'SDD-012',
    kind: 'SDD',
    title: 'Importador incremental por hash',
    status: 'active',
    architects: ['FR-002'],
    impactsPaths: [
      'packages/server/src/import/scan.ts',
      'packages/server/src/import/hash-table.ts',
      'packages/cli/src/commands/import.ts',
    ],
    changedAt: '2026-09-15T10:02:00.000Z',
    sample: true,
  },
];

export function getBlueprint(id: string): Blueprint | undefined {
  return BLUEPRINTS.find((blueprint) => blueprint.id === id);
}
