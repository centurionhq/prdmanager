/**
 * When the preview editor must be read-only (SDD-014 §"Editor de vista previa", WO-382): the server's own
 * authorized collaboration `scope` (never a client-side re-derived guess, same reasoning as
 * `CollabEditor.tsx`'s existing `readOnly`), a `generated`/`archived` document, no live connection, or a
 * mobile viewport (small enough that the toolbar has nowhere to go — same breakpoint the rest of the app
 * uses, `../lib/use-media-query.js`).
 */
import type { CollabAuthorizedScope, CollabConnectionStatus } from '../collab/use-collab-provider.js';

// Mirrors `DocumentStateBanner.tsx`'s own `DocumentBannerVariant` type by hand rather than importing it:
// that component lives in a `.tsx` file, and a plain `tsc --noEmit` project with no `--jsx` flag (this
// app's Node unit-test project) can't resolve it even for a type-only import (TS6142) — the same reason
// `remote-cursors.ts`/`RemoteCursors.tsx` are two separate files.
type DocumentBannerVariant = 'generado' | 'archivado' | 'solo_lectura' | 'desconectado';

export interface PreviewReadOnlyInputs {
  collabScope: CollabAuthorizedScope | null;
  connectionStatus: CollabConnectionStatus;
  isGenerated: boolean;
  isArchived: boolean;
  isMobile: boolean;
}

export function isPreviewReadOnly(inputs: PreviewReadOnlyInputs): boolean {
  if (inputs.isMobile) return true;
  if (inputs.connectionStatus !== 'connected') return true;
  if (inputs.isGenerated || inputs.isArchived) return true;
  return inputs.collabScope === 'readonly';
}

/**
 * Same banner priority as `CollabEditor.tsx`'s pre-existing `bannerVariantFor` (WO-383 replaces that local
 * copy with this shared one): a broken connection always wins, then the document's own permanent state
 * (`generado`/`archivado`), then the server-authorized `readonly` scope. Mobile-triggered read-only has no
 * banner of its own — it's a viewport constraint, not a document state, so `null` here is correct even
 * while `isPreviewReadOnly` is `true`.
 */
export function previewReadOnlyBanner(inputs: Omit<PreviewReadOnlyInputs, 'isMobile'>): DocumentBannerVariant | null {
  if (inputs.connectionStatus === 'disconnected') return 'desconectado';
  if (inputs.isGenerated) return 'generado';
  if (inputs.isArchived) return 'archivado';
  if (inputs.collabScope === 'readonly') return 'solo_lectura';
  return null;
}
