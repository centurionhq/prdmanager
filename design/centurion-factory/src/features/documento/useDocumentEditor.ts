/**
 * Local, mutable state for the Documento screen (WO-287). Seeded from the mock data and never
 * mutating it; grows in WO-288 (workflow + role), WO-289 (agent proposals) and WO-290 (comments,
 * versions, validation) without changing this shape's contract.
 */
import { useMemo, useState } from 'react';
import { getBlueprint, getDocument, getPerson, versionsForDocument, type DocumentVersion, type ProjectDocument } from '../../data';
import { formatRelative } from './format';

/** "Editás/Editada como Admin de proyecto" in the header: the simulated current session. */
export const CURRENT_USER_ID = 'ana-rios';
export const CURRENT_USER_NAME = 'Ana Ríos';

export interface UseDocumentEditorResult {
  readonly document: ProjectDocument | undefined;
  readonly versions: readonly DocumentVersion[];
  readonly metaLine: string;
  readonly architectOf: string | undefined;
  readonly save: () => void;
}

function nextVersionNumber(versions: readonly DocumentVersion[]): number {
  return versions.reduce((max, version) => Math.max(max, version.versionNo), 0) + 1;
}

function metaLineFor(document: ProjectDocument, savedJustNow: boolean, now: Date): string {
  const author = savedJustNow ? CURRENT_USER_NAME : (getPerson(document.updatedBy)?.name ?? document.updatedBy);
  const when = savedJustNow ? 'ahora' : formatRelative(document.updatedAt, now);
  return `${savedJustNow ? 'Guardado' : 'Editado'} por ${author} ${when}`;
}

export function useDocumentEditor(id: string, now: Date = new Date()): UseDocumentEditorResult {
  const document = useMemo(() => getDocument(id), [id]);
  const architectOf = useMemo(() => getBlueprint(id)?.architects[0], [id]);
  const [versions, setVersions] = useState<readonly DocumentVersion[]>(() => [...versionsForDocument(id)]);
  const [savedJustNow, setSavedJustNow] = useState(false);

  function addVersion(reason: DocumentVersion['reason'], label?: string): void {
    if (!document) return;
    const version: DocumentVersion = {
      documentId: id,
      versionNo: nextVersionNumber(versions),
      reason,
      createdBy: CURRENT_USER_ID,
      createdAt: new Date().toISOString(),
      contributors: [CURRENT_USER_ID],
      ...(label ? { label } : {}),
    };
    setVersions((current) => [...current, version]);
  }

  function save(): void {
    addVersion('manual');
    setSavedJustNow(true);
  }

  const metaLine = document ? metaLineFor(document, savedJustNow, now) : '';

  return { document, versions, metaLine, architectOf, save };
}
