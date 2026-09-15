/**
 * Comment threads (WO-271). 0-4 threads per document, mixing open and resolved. SDD-011 has
 * exactly 2 open threads per the spec.
 */
import type { CommentThread } from './types';

function thread(
  id: string,
  documentId: string,
  quotedText: string,
  status: CommentThread['status'],
  createdBy: string,
  comments: readonly { readonly authorId: string; readonly body: string; readonly createdAt: string }[],
  resolvedBy?: string,
): CommentThread {
  return { id, documentId, quotedText, status, createdBy, comments, ...(resolvedBy ? { resolvedBy } : {}) };
}

export const COMMENT_THREADS: readonly CommentThread[] = [
  thread('cm-001', 'SDD-011', 'solo con datos mock', 'open', 'julia-paz', [
    { authorId: 'julia-paz', body: '¿Esto incluye la exportación a PDF de FR-004 o eso queda para más adelante?', createdAt: '2026-09-15T07:15:00.000Z' },
  ]),
  thread('cm-002', 'SDD-011', 'Barra inferior mobile de 64 px con cinco destinos y Más.', 'open', 'ana-rios', [
    { authorId: 'ana-rios', body: '¿"Más" abre un menú o navega a una pantalla propia?', createdAt: '2026-09-15T08:05:00.000Z' },
    { authorId: 'julia-paz', body: 'Un menú, como en el artboard de PlantaMobile.', createdAt: '2026-09-15T08:20:00.000Z' },
  ]),
  thread('cm-003', 'MRD-001', 'Desincronización de contexto', 'resolved', 'lucas-vera', [
    { authorId: 'lucas-vera', body: '¿Tenemos algún dato de cuánto tiempo se pierde por esto?', createdAt: '2026-09-12T09:30:00.000Z' },
    { authorId: 'ana-rios', body: 'Sí, lo agregamos en la sección de personas: horas por semana por PM.', createdAt: '2026-09-12T09:50:00.000Z' },
  ], 'ana-rios'),
  thread('cm-004', 'PRD-001', 'Feature Tree', 'open', 'martin-sosa', [
    { authorId: 'martin-sosa', body: '¿El árbol soporta más de un MRD raíz por proyecto?', createdAt: '2026-09-12T11:20:00.000Z' },
  ]),
  thread('cm-005', 'PRD-001', 'detectar dependencias rotas', 'resolved', 'sofia-ibarra', [
    { authorId: 'sofia-ibarra', body: '¿"rotas" incluye enlaces a documentos borrados?', createdAt: '2026-09-12T11:40:00.000Z' },
    { authorId: 'julia-paz', body: 'Sí, ese es justamente el caso invalid_link_target.', createdAt: '2026-09-12T11:55:00.000Z' },
  ], 'julia-paz'),
  thread('cm-006', 'PRD-004', 'explorador local de solo lectura', 'resolved', 'martin-sosa', [
    { authorId: 'martin-sosa', body: '¿Por qué solo lectura y no también edición?', createdAt: '2026-09-13T18:30:00.000Z' },
    { authorId: 'ana-rios', body: 'Para no duplicar la autoría conversacional del MCP en dos lugares.', createdAt: '2026-09-13T18:45:00.000Z' },
  ], 'ana-rios'),
  thread('cm-007', 'PRD-005', 'multi-organización', 'open', 'lucas-vera', [
    { authorId: 'lucas-vera', body: '¿Una organización puede tener proyectos en distintos planes?', createdAt: '2026-09-13T17:00:00.000Z' },
  ]),
  thread('cm-008', 'PRD-005', 'aislamiento entre organizaciones', 'resolved', 'sofia-ibarra', [
    { authorId: 'sofia-ibarra', body: '¿Esto está cubierto por la suite de RLS de SDD-006?', createdAt: '2026-09-13T17:30:00.000Z' },
    { authorId: 'ana-rios', body: 'Sí, en la sección de aislamiento de tres capas.', createdAt: '2026-09-13T17:45:00.000Z' },
  ], 'ana-rios'),
  thread('cm-009', 'PRD-006', 'la lámpara de parada de línea', 'open', 'martin-sosa', [
    { authorId: 'martin-sosa', body: '¿El andon parpadea o solo cambia de color?', createdAt: '2026-09-15T07:20:00.000Z' },
  ]),
  thread('cm-010', 'PRD-006', 'las seis estaciones del ciclo de vida', 'open', 'lucas-vera', [
    { authorId: 'lucas-vera', body: '¿Una feature puede saltarse una estación?', createdAt: '2026-09-15T07:45:00.000Z' },
  ]),
  thread('cm-011', 'PRD-006', 'Cianotipo', 'resolved', 'sofia-ibarra', [
    { authorId: 'sofia-ibarra', body: '¿Cianotipo es solo para blueprints o también para links en general?', createdAt: '2026-09-15T08:10:00.000Z' },
    { authorId: 'ana-rios', body: 'También para links y acciones primarias, ver la tabla de tokens.', createdAt: '2026-09-15T08:25:00.000Z' },
  ], 'ana-rios'),
  thread('cm-012', 'FR-001', 'un archivo por proceso', 'open', 'martin-sosa', [
    { authorId: 'martin-sosa', body: '¿Qué pasa si dos procesos escriben el mismo borrador a la vez?', createdAt: '2026-09-13T19:45:00.000Z' },
  ]),
  thread('cm-013', 'FR-002', 'hash de archivo', 'open', 'ana-rios', [
    { authorId: 'ana-rios', body: '¿El hash es por archivo completo o por bloque?', createdAt: '2026-09-14T08:10:00.000Z' },
  ]),
  thread('cm-014', 'FR-002', 'archivos borrados', 'resolved', 'lucas-vera', [
    { authorId: 'lucas-vera', body: '¿Un archivo borrado se elimina de la tabla de hashes?', createdAt: '2026-09-14T08:40:00.000Z' },
    { authorId: 'martin-sosa', body: 'No, queda marcado como borrado para el resumen de la CLI.', createdAt: '2026-09-14T08:55:00.000Z' },
  ], 'martin-sosa'),
  thread('cm-015', 'SDD-002', 'escrituras atómicas entre disco y Neo4j', 'resolved', 'martin-sosa', [
    { authorId: 'martin-sosa', body: '¿Hay un límite de tamaño para la transacción atómica?', createdAt: '2026-09-13T09:40:00.000Z' },
    { authorId: 'julia-paz', body: 'No hoy, pero está anotado como riesgo para proyectos muy grandes.', createdAt: '2026-09-13T09:55:00.000Z' },
  ], 'julia-paz'),
  thread('cm-016', 'SDD-012', 'tabla de hashes', 'open', 'martin-sosa', [
    { authorId: 'martin-sosa', body: 'Voy a agregar un índice por (repo_id, path) para acelerar el escaneo.', createdAt: '2026-09-15T09:10:00.000Z' },
  ]),
  thread('cm-017', 'ADR-007', 'fuera de los npm workspaces', 'open', 'martin-sosa', [
    { authorId: 'martin-sosa', body: '¿Esto complica portar las pantallas a packages/app más adelante?', createdAt: '2026-09-15T09:35:00.000Z' },
  ]),
];

export function commentsForDocument(documentId: string): readonly CommentThread[] {
  return COMMENT_THREADS.filter((thread) => thread.documentId === documentId);
}
