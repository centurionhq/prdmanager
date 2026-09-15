/** Version history state and creation for the Documento screen: `save`/`transition`/proposals/restore all append a version. */
import { useState } from 'react';
import { versionsForDocument, type DocumentVersion, type ProjectDocument, type VersionReason } from '../../data';
import { CURRENT_USER_ID } from './documentEditorConstants';

function nextVersionNumber(versions: readonly DocumentVersion[]): number {
  return versions.reduce((max, version) => Math.max(max, version.versionNo), 0) + 1;
}

export interface UseVersionHistoryResult {
  readonly versions: readonly DocumentVersion[];
  readonly addVersion: (reason: VersionReason, label?: string) => void;
  readonly restoreVersion: (versionNo: number) => string;
}

export function useVersionHistory(id: string, document: ProjectDocument | undefined): UseVersionHistoryResult {
  const [versions, setVersions] = useState<readonly DocumentVersion[]>(() => [...versionsForDocument(id)]);

  function addVersion(reason: VersionReason, label?: string): void {
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

  function restoreVersion(versionNo: number): string {
    addVersion('restore', `Restaurada de la versión ${versionNo}`);
    return 'Versión restaurada';
  }

  return { versions, addVersion, restoreVersion };
}
