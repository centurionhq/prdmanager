/**
 * The simulated current session (Ana Ríos, admin), shown through the header's "Ver como" role select. Kept in its own
 * module so the editor-state hooks (useVersionHistory, useProposalActions, ...) can share it
 * without a circular import on useDocumentEditor, which re-exports it for existing callers.
 */
export const CURRENT_USER_ID = 'ana-rios';
export const CURRENT_USER_NAME = 'Ana Ríos';
