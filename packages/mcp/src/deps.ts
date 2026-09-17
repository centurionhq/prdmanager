import type { AuthoringService, GraphStore, PrdmConfig, ProjectEngine } from '@prdm/core';
import type { RemoteDocumentsPort } from './documents-port.js';

/** Everything a tool/resource/prompt handler needs; built once at startup and shared by every registration. */
export interface PrdmDeps {
  config: PrdmConfig;
  store: GraphStore;
  engine: ProjectEngine;
  /**
   * Conversational authoring surface (SDD-002 "Autoría conversacional"); one DraftStore per server process.
   * Optional (WO-126/SDD-007): a future remote profile (SDD-010) omits it entirely. Every current caller must
   * go through `requireAuthoring` instead of assuming it is present.
   */
  authoring?: AuthoringService;
  /**
   * SaaS document create/edit/publish surface (SDD-020, WO-421). Only the remote profile's
   * `tools-remote-authoring.ts` sets this (a local/stdio project has no `draft -> in_review -> published`
   * workflow at all — see this port's own doc comment); every caller must go through
   * `requireDocumentsPort` instead of assuming it is present.
   */
  documents?: RemoteDocumentsPort;
}

/** Throws a clear, user-facing error instead of a `Cannot read properties of undefined` when a profile has no authoring surface (SDD-010's remote profile, not built yet). */
export function requireAuthoring(deps: PrdmDeps): AuthoringService {
  if (!deps.authoring) throw new Error('authoring not available in this profile');
  return deps.authoring;
}

/** Throws a clear, user-facing error instead of a `Cannot read properties of undefined` when a profile has no documents port (the local/stdio profile, WO-421). */
export function requireDocumentsPort(deps: PrdmDeps): RemoteDocumentsPort {
  if (!deps.documents) throw new Error('remote document authoring not available in this profile');
  return deps.documents;
}
