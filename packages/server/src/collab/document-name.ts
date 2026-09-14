/**
 * `/collab`'s Hocuspocus `documentName` is always `<projectUuid>:<documentUuid>` (SDD-008 §"Servidor de
 * tiempo real"). Parsing lives in one place so `onAuthenticate`, the persistence extension and the
 * isolation-suite probes (WO-146/145/147) can never disagree about the format.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const DOCUMENT_NAME_PATTERN = new RegExp(`^(${UUID}):(${UUID})$`);

export interface ParsedDocumentName {
  projectId: string;
  documentId: string;
}

/** `null` for anything that isn't exactly `<uuid>:<uuid>` — never throws, so a malformed/forged
 * `documentName` is just another rejection, not a crash. */
export function parseDocumentName(documentName: string): ParsedDocumentName | null {
  const match = DOCUMENT_NAME_PATTERN.exec(documentName);
  if (!match) return null;
  const [, projectId, documentId] = match;
  if (!projectId || !documentId) return null;
  return { projectId, documentId };
}

export function formatDocumentName(projectId: string, documentId: string): string {
  return `${projectId}:${documentId}`;
}
