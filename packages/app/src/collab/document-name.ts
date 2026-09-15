/** `/collab`'s `documentName` format (SDD-008 §"Servidor de tiempo real"): `<projectUuid>:<documentUuid>`
 * — mirrors `packages/server/src/collab/document-name.ts`'s `formatDocumentName` by hand (SDD-006
 * §Arquitectura: `packages/app` never depends on `packages/server`). */
export function formatCollabDocumentName(projectId: string, documentId: string): string {
  return `${projectId}:${documentId}`;
}
