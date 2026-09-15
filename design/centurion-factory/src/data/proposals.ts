/**
 * Agent proposals (WO-271): pending on SDD-011 (exactly as shown in canvas/Documento.dc.html),
 * one accepted, one stale.
 */
import type { AgentProposal } from './types';

export const AGENT_PROPOSALS: readonly AgentProposal[] = [
  {
    id: 'prop-001',
    documentId: 'SDD-011',
    agent: 'agent:claude',
    status: 'pending',
    summary: 'Agregar la tarea de capturas a 375 px',
    edits: [
      {
        section: 'Tareas',
        expectedText: '- [ ] Revisión visual manual en mobile',
        replacement: '- [ ] Capturas de cada vista a 375 px',
      },
    ],
    requestedBy: 'ana-rios',
    createdAt: '2026-09-15T09:47:00.000Z',
  },
  {
    id: 'prop-002',
    documentId: 'FR-002',
    agent: 'agent:deepseek',
    status: 'accepted',
    summary: 'Agregar un ejemplo de archivo omitido en la sección Decisiones',
    edits: [
      {
        section: 'Decisiones',
        expectedText: 'Escanea solo los archivos que cambiaron desde la última importación, por hash.',
        replacement:
          'Escanea solo los archivos que cambiaron desde la última importación, por hash (por ejemplo, un archivo con el mismo hash se omite del resumen).',
      },
    ],
    requestedBy: 'martin-sosa',
    respondedBy: 'ana-rios',
    createdAt: '2026-09-12T10:00:00.000Z',
  },
  {
    id: 'prop-003',
    documentId: 'SDD-012',
    agent: 'agent:claude',
    status: 'stale',
    summary: 'Actualizar impacts_paths con hash-table.ts',
    edits: [
      {
        section: 'Frontmatter',
        expectedText: 'impacts_paths: ["packages/server/src/import/scan.ts"]',
        replacement: 'impacts_paths: ["packages/server/src/import/scan.ts", "packages/server/src/import/hash-table.ts"]',
      },
    ],
    requestedBy: 'ana-rios',
    createdAt: '2026-09-13T09:00:00.000Z',
  },
];

export function proposalsForDocument(documentId: string): readonly AgentProposal[] {
  return AGENT_PROPOSALS.filter((proposal) => proposal.documentId === documentId);
}
