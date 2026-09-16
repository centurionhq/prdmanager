/**
 * WO-382 — `isPreviewReadOnly` covers every condition that forces the preview editor read-only
 * independently (collaboration `readonly` scope, a `generated`/`archived` document, a broken connection,
 * or a mobile viewport). `previewReadOnlyBanner` mirrors `CollabEditor.tsx`'s pre-existing banner priority
 * (`desconectado` > `generado`/`archivado` > `solo_lectura`), reused rather than duplicated in WO-383.
 */
import { describe, expect, it } from 'vitest';
import { isPreviewReadOnly, previewReadOnlyBanner, type PreviewReadOnlyInputs } from '../../../src/editor/preview-readonly.js';

const CONNECTED_EDITABLE: PreviewReadOnlyInputs = {
  collabScope: 'read-write',
  connectionStatus: 'connected',
  isGenerated: false,
  isArchived: false,
  isMobile: false,
};

describe('isPreviewReadOnly', () => {
  it('is false when connected, read-write, not generated/archived, and not mobile', () => {
    expect(isPreviewReadOnly(CONNECTED_EDITABLE)).toBe(false);
  });

  it('is true when the collaboration scope is readonly', () => {
    expect(isPreviewReadOnly({ ...CONNECTED_EDITABLE, collabScope: 'readonly' })).toBe(true);
  });

  it('is true for a generated document', () => {
    expect(isPreviewReadOnly({ ...CONNECTED_EDITABLE, isGenerated: true })).toBe(true);
  });

  it('is true for an archived document', () => {
    expect(isPreviewReadOnly({ ...CONNECTED_EDITABLE, isArchived: true })).toBe(true);
  });

  it('is true when disconnected', () => {
    expect(isPreviewReadOnly({ ...CONNECTED_EDITABLE, connectionStatus: 'disconnected' })).toBe(true);
  });

  it('is true when connecting (not yet confirmed read-write)', () => {
    expect(isPreviewReadOnly({ ...CONNECTED_EDITABLE, connectionStatus: 'connecting' })).toBe(true);
  });

  it('is true on a mobile viewport regardless of every other condition', () => {
    expect(isPreviewReadOnly({ ...CONNECTED_EDITABLE, isMobile: true })).toBe(true);
  });
});

describe('previewReadOnlyBanner', () => {
  it('returns null when nothing forces read-only', () => {
    expect(previewReadOnlyBanner(CONNECTED_EDITABLE)).toBeNull();
  });

  it('prioritizes "desconectado" over every other reason', () => {
    expect(
      previewReadOnlyBanner({ ...CONNECTED_EDITABLE, connectionStatus: 'disconnected', isArchived: true, collabScope: 'readonly' }),
    ).toBe('desconectado');
  });

  it('shows "generado" for a generated document even if also archived', () => {
    expect(previewReadOnlyBanner({ ...CONNECTED_EDITABLE, isGenerated: true, isArchived: true })).toBe('generado');
  });

  it('shows "archivado" for an archived (non-generated) document', () => {
    expect(previewReadOnlyBanner({ ...CONNECTED_EDITABLE, isArchived: true })).toBe('archivado');
  });

  it('shows "solo_lectura" for a readonly collaboration scope on an otherwise-normal document', () => {
    expect(previewReadOnlyBanner({ ...CONNECTED_EDITABLE, collabScope: 'readonly' })).toBe('solo_lectura');
  });
});
