import type { DocKind } from '../domain/schema.js';

/** `prj_` + 16 lowercase hex chars; also a single Lucene token under the standard analyzer (ADR-002 D5/D6). */
export const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{16}$/;

export type FolderMap = Readonly<Record<DocKind, string>>;

export const DEFAULT_FOLDERS: FolderMap = {
  MRD: 'docs/mrd',
  PRD: 'docs/prd',
  FR: 'docs/fr',
  SDD: 'docs/sdd',
  ADR: 'docs/adr',
  WO: 'docs/work-orders',
  FB: 'docs/feedback',
  ART: 'docs/artifacts',
};

/** Identity of the active project; `root` is the realpath used as the graph partition fingerprint (SDD-002 "Proyecto activo"). */
export interface ProjectRef {
  id: string;
  name: string;
  root: string;
}

export interface GitSettings {
  maxCommits: number;
  enforceRefs: boolean;
  /** Commits that are not descendants of this sha are exempt from Refs enforcement; null = enforce everything. */
  enforceRefsSince: string | null;
}

export interface GrandfatheredDoc {
  id: string;
  hash: string;
}

export interface LifecycleSettings {
  grandfathered: GrandfatheredDoc[];
}

export interface AuthoringSettings {
  draftTtlMinutes: number;
  maxDrafts: number;
  maxDraftBytes: number;
}

export const DEFAULT_GIT: GitSettings = { maxCommits: 500, enforceRefs: true, enforceRefsSince: null };
export const DEFAULT_LIFECYCLE: LifecycleSettings = { grandfathered: [] };
export const DEFAULT_AUTHORING: AuthoringSettings = { draftTtlMinutes: 60, maxDrafts: 20, maxDraftBytes: 262_144 };

export function assertProjectId(id: string): string {
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error(`invalid project id "${id}" (expected prj_ followed by 16 hex chars)`);
  return id;
}
