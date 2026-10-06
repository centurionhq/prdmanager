import { projectSettingsSchema } from '@prdm/contracts';
import { describe, expect, it } from 'vitest';
import { isFormValid, toForm, toSettings, validateForm, type ProjectSettingsForm } from '../../src/lib/project-settings-form.js';

const FULL = projectSettingsSchema.parse({
  folders: { MRD: 'docs/mrd', PRD: 'docs/prd', FR: 'docs/fr', SDD: 'docs/sdd', ADR: 'docs/adr', WO: 'docs/wo', ART: 'docs/art', FB: 'docs/fb' },
  ignore: ['node_modules/**', 'dist/**'],
  git: { max_commits: 250, enforce_refs: false, enforce_refs_since: 'abc1234' },
  triage: { auto_link_min_score: 0.8, auto_link_margin: 1.5, max_candidates: 7, min_matched_terms: 3 },
  lifecycle: { grandfathered: [{ id: 'PRD-001', hash: 'a'.repeat(64) }] },
  default_branch: 'develop',
  github_repository: 'acme/web',
  github_repository_id: 42,
  github_owner_id: 7,
  hash_algo_version: 2,
});

function validForm(change: Partial<ProjectSettingsForm> = {}): ProjectSettingsForm {
  return { ...toForm(FULL), ...change };
}

describe('project settings form round trip', () => {
  it('restores a complete settings object unchanged', () => {
    expect(toSettings(toForm(FULL))).toEqual(FULL);
  });

  it('restores the defaults of an empty settings object unchanged', () => {
    const defaults = projectSettingsSchema.parse({});
    expect(toSettings(toForm(defaults))).toEqual(defaults);
  });

  it('omits an empty folder and trims the others', () => {
    const settings = toSettings(validForm({ folders: { ...toForm(FULL).folders, MRD: '', PRD: ' docs/prd ' } }));
    expect(settings.folders).not.toHaveProperty('MRD');
    expect(settings.folders.PRD).toBe('docs/prd');
  });

  it('splits ignore by line, trimming and dropping blanks', () => {
    expect(toSettings(validForm({ ignore: ' a \n\n b\n  ' })).ignore).toEqual(['a', 'b']);
  });
});

describe('validateForm', () => {
  it('returns no errors for a valid form', () => {
    expect(validateForm(validForm())).toEqual({});
    expect(isFormValid(validForm())).toBe(true);
  });

  it('accepts empty folders but rejects a blank one', () => {
    const folders = { ...toForm(FULL).folders, MRD: '', PRD: '   ' };
    expect(validateForm(validForm({ folders }))).toEqual({
      'folders.PRD': 'Escribí la carpeta de Producto (PRD), o dejala vacía para no definirla.',
    });
  });

  it.each([
    ['defaultBranch', { defaultBranch: '' }, 'Escribí el nombre de la rama.'],
    ['defaultBranch', { defaultBranch: 'x'.repeat(256) }, 'La rama no puede tener más de 255 caracteres.'],
    ['githubRepository', { githubRepository: 'not-a-repo' }, 'Escribí un repositorio con la forma owner/repo.'],
    ['githubRepositoryId', { githubRepositoryId: '0' }, 'Escribí un número entero mayor que 0.'],
    ['githubOwnerId', { githubOwnerId: '1.5' }, 'Escribí un número entero mayor que 0.'],
    ['hashAlgoVersion', { hashAlgoVersion: '0' }, 'Escribí un número entero mayor que 0.'],
  ] as const)('flags %s', (field, change, message) => {
    const errors = validateForm(validForm(change));
    expect(errors).toEqual({ [field]: message });
    expect(isFormValid(validForm(change))).toBe(false);
  });

  it.each([
    ['git.maxCommits', '', 'Escribí un número.'],
    ['git.maxCommits', '1.5', 'Escribí un número entero.'],
    ['git.maxCommits', '0', 'El número tiene que estar entre 1 y 100000.'],
    ['git.maxCommits', '100001', 'El número tiene que estar entre 1 y 100000.'],
    ['git.enforceRefsSince', 'zzz', 'Escribí un sha de 7 a 40 caracteres hexadecimales, o dejá el campo vacío.'],
    ['triage.autoLinkMinScore', 'abc', 'Escribí un número.'],
    ['triage.autoLinkMinScore', '0', 'El número tiene que ser mayor que 0.'],
    ['triage.autoLinkMargin', '0.5', 'El número tiene que ser igual o mayor que 1.'],
    ['triage.maxCandidates', '2.5', 'Escribí un número entero.'],
    ['triage.maxCandidates', '100', 'El número tiene que estar entre 1 y 50.'],
    ['triage.minMatchedTerms', '-1', 'El número tiene que ser igual o mayor que 0.'],
  ] as const)('flags %s = %j', (field, value, message) => {
    const base = toForm(FULL);
    const [group, key] = field.split('.') as ['git' | 'triage', string];
    const form = { ...base, [group]: { ...base[group], [key]: value } } as ProjectSettingsForm;
    expect(validateForm(form)).toEqual({ [field]: message });
  });

  it('lets git.enforceRefsSince be empty', () => {
    const base = toForm(FULL);
    expect(validateForm({ ...base, git: { ...base.git, enforceRefsSince: '' } })).toEqual({});
  });
});
