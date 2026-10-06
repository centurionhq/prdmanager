/**
 * Ajustes/General's form model (SDD-090 D1, WO-702): the nine fields of `projectSettingsSchema` as the strings
 * and booleans the inputs hold, the round trip to and from the settings object, and a validator that applies the
 * SAME rules as the server's schema (`packages/contracts/src/project-settings.ts`) so the client is never
 * stricter -- or looser -- than the endpoint. Pure: no React.
 */
import type { ProjectSettings } from '@prdm/contracts';

export const FOLDER_FIELDS = [
  { kind: 'MRD', label: 'Mercado (MRD)' },
  { kind: 'PRD', label: 'Producto (PRD)' },
  { kind: 'FR', label: 'Feature request (FR)' },
  { kind: 'SDD', label: 'Blueprint (SDD)' },
  { kind: 'ADR', label: 'Decisión (ADR)' },
  { kind: 'WO', label: 'Orden de trabajo (WO)' },
  { kind: 'ART', label: 'Artefacto (ART)' },
  { kind: 'FB', label: 'Feedback (FB)' },
] as const;
export type FolderKind = (typeof FOLDER_FIELDS)[number]['kind'];

export interface ProjectSettingsForm {
  readonly defaultBranch: string;
  readonly folders: Readonly<Record<FolderKind, string>>;
  /** Una línea por patrón. */
  readonly ignore: string;
  readonly git: { readonly maxCommits: string; readonly enforceRefs: boolean; readonly enforceRefsSince: string };
  readonly triage: {
    readonly autoLinkMinScore: string;
    readonly autoLinkMargin: string;
    readonly maxCandidates: string;
    readonly minMatchedTerms: string;
  };
  readonly githubRepository: string;
  readonly githubRepositoryId: string;
  readonly githubOwnerId: string;
  readonly hashAlgoVersion: string;
  /** Passthrough: not edited here, but the PATCH replaces the whole object. */
  readonly grandfathered: ProjectSettings['lifecycle']['grandfathered'];
}

export type ProjectSettingsFormErrors = Partial<
  Record<
    | 'defaultBranch'
    | `folders.${FolderKind}`
    | 'git.maxCommits'
    | 'git.enforceRefsSince'
    | 'triage.autoLinkMinScore'
    | 'triage.autoLinkMargin'
    | 'triage.maxCandidates'
    | 'triage.minMatchedTerms'
    | 'githubRepository'
    | 'githubRepositoryId'
    | 'githubOwnerId'
    | 'hashAlgoVersion',
    string
  >
>;

/** Kept in sync by hand with `project-settings.ts` (contracts), as that file does with `@prdm/core`. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const MAX_BRANCH_LENGTH = 255;
const MAX_COMMITS_LIMIT = 100_000;
const MAX_CANDIDATES_LIMIT = 50;

const orEmpty = (value: string | number | null): string => (value === null ? '' : String(value));
const orNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));

export function toForm(settings: ProjectSettings): ProjectSettingsForm {
  const folders = Object.fromEntries(FOLDER_FIELDS.map(({ kind }) => [kind, settings.folders[kind] ?? ''])) as Record<FolderKind, string>;
  return {
    defaultBranch: settings.default_branch,
    folders,
    ignore: settings.ignore.join('\n'),
    git: {
      maxCommits: String(settings.git.max_commits),
      enforceRefs: settings.git.enforce_refs,
      enforceRefsSince: orEmpty(settings.git.enforce_refs_since),
    },
    triage: {
      autoLinkMinScore: String(settings.triage.auto_link_min_score),
      autoLinkMargin: String(settings.triage.auto_link_margin),
      maxCandidates: String(settings.triage.max_candidates),
      minMatchedTerms: String(settings.triage.min_matched_terms),
    },
    githubRepository: orEmpty(settings.github_repository),
    githubRepositoryId: orEmpty(settings.github_repository_id),
    githubOwnerId: orEmpty(settings.github_owner_id),
    hashAlgoVersion: String(settings.hash_algo_version),
    grandfathered: settings.lifecycle.grandfathered,
  };
}

/** A total conversion (no validation): the screen calls `validateForm` first. Always the COMPLETE object. */
export function toSettings(form: ProjectSettingsForm): ProjectSettings {
  const folders: ProjectSettings['folders'] = Object.fromEntries(
    FOLDER_FIELDS.map(({ kind }) => [kind, form.folders[kind].trim()] as const).filter(([, value]) => value !== ''),
  );
  const since = form.git.enforceRefsSince.trim();
  const repository = form.githubRepository.trim();
  return {
    folders,
    ignore: form.ignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
    git: {
      max_commits: Number(form.git.maxCommits),
      enforce_refs: form.git.enforceRefs,
      enforce_refs_since: since === '' ? null : since,
    },
    triage: {
      auto_link_min_score: Number(form.triage.autoLinkMinScore),
      auto_link_margin: Number(form.triage.autoLinkMargin),
      max_candidates: Number(form.triage.maxCandidates),
      min_matched_terms: Number(form.triage.minMatchedTerms),
    },
    lifecycle: { grandfathered: form.grandfathered },
    default_branch: form.defaultBranch.trim(),
    github_repository: repository === '' ? null : repository,
    github_repository_id: orNull(form.githubRepositoryId),
    github_owner_id: orNull(form.githubOwnerId),
    hash_algo_version: Number(form.hashAlgoVersion),
  };
}

const NOT_A_NUMBER = 'Escribí un número.';
const NOT_AN_INTEGER = 'Escribí un número entero.';
const POSITIVE_INTEGER = 'Escribí un número entero mayor que 0.';

/** `null` when the text is a number; otherwise the message every numeric field shares. */
function parseNumber(text: string): number | string {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed === '' || !Number.isFinite(value) ? NOT_A_NUMBER : value;
}

function checkInteger(text: string, check: (value: number) => string | undefined): string | undefined {
  const value = parseNumber(text);
  if (typeof value === 'string') return value;
  if (!Number.isInteger(value)) return NOT_AN_INTEGER;
  return check(value);
}

function checkPositiveInteger(text: string): string | undefined {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(value) && value > 0 ? undefined : POSITIVE_INTEGER;
}

export function validateForm(form: ProjectSettingsForm): ProjectSettingsFormErrors {
  const errors: Record<string, string | undefined> = {};

  const branch = form.defaultBranch.trim();
  if (branch === '') errors.defaultBranch = 'Escribí el nombre de la rama.';
  else if (branch.length > MAX_BRANCH_LENGTH) errors.defaultBranch = `La rama no puede tener más de ${MAX_BRANCH_LENGTH} caracteres.`;

  for (const { kind, label } of FOLDER_FIELDS) {
    const raw = form.folders[kind];
    if (raw !== '' && raw.trim() === '') errors[`folders.${kind}`] = `Escribí la carpeta de ${label}, o dejala vacía para no definirla.`;
  }

  errors['git.maxCommits'] = checkInteger(form.git.maxCommits, (value) =>
    value < 1 || value > MAX_COMMITS_LIMIT ? `El número tiene que estar entre 1 y ${MAX_COMMITS_LIMIT}.` : undefined,
  );
  const since = form.git.enforceRefsSince.trim();
  if (since !== '' && !SHA_PATTERN.test(since)) {
    errors['git.enforceRefsSince'] = 'Escribí un sha de 7 a 40 caracteres hexadecimales, o dejá el campo vacío.';
  }

  const score = parseNumber(form.triage.autoLinkMinScore);
  if (typeof score === 'string') errors['triage.autoLinkMinScore'] = score;
  else if (score <= 0) errors['triage.autoLinkMinScore'] = 'El número tiene que ser mayor que 0.';
  const margin = parseNumber(form.triage.autoLinkMargin);
  if (typeof margin === 'string') errors['triage.autoLinkMargin'] = margin;
  else if (margin < 1) errors['triage.autoLinkMargin'] = 'El número tiene que ser igual o mayor que 1.';
  errors['triage.maxCandidates'] = checkInteger(form.triage.maxCandidates, (value) =>
    value < 1 || value > MAX_CANDIDATES_LIMIT ? `El número tiene que estar entre 1 y ${MAX_CANDIDATES_LIMIT}.` : undefined,
  );
  errors['triage.minMatchedTerms'] = checkInteger(form.triage.minMatchedTerms, (value) =>
    value < 0 ? 'El número tiene que ser igual o mayor que 0.' : undefined,
  );

  const repository = form.githubRepository.trim();
  if (repository !== '' && !GITHUB_REPOSITORY_PATTERN.test(repository)) {
    errors.githubRepository = 'Escribí un repositorio con la forma owner/repo.';
  }
  if (form.githubRepositoryId.trim() !== '') errors.githubRepositoryId = checkPositiveInteger(form.githubRepositoryId);
  if (form.githubOwnerId.trim() !== '') errors.githubOwnerId = checkPositiveInteger(form.githubOwnerId);
  errors.hashAlgoVersion = checkPositiveInteger(form.hashAlgoVersion);

  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message !== undefined)) as ProjectSettingsFormErrors;
}

export function isFormValid(form: ProjectSettingsForm): boolean {
  return Object.keys(validateForm(form)).length === 0;
}
