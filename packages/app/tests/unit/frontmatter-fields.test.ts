import { describe, expect, test } from 'vitest';
import { frontmatterFieldsForKind, validateFrontmatterFields } from '../../src/collab/frontmatter-fields.js';

describe('frontmatterFieldsForKind', () => {
  test('a Feature kind (PRD) exposes title/tags/relations, never a server-managed field', () => {
    const keys = frontmatterFieldsForKind('PRD').map((f) => f.key);
    expect(keys).toEqual(['title', 'tags', 'implements', 'evolves_from', 'justified_by']);
    expect(keys).not.toContain('id');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('closed_at');
  });

  test('a Blueprint kind (SDD) exposes architects/impacts_paths', () => {
    const keys = frontmatterFieldsForKind('SDD').map((f) => f.key);
    expect(keys).toEqual(['title', 'tags', 'architects', 'impacts_paths']);
  });

  test('an Artifact kind (ART) exposes source/provides_context_for/root', () => {
    const keys = frontmatterFieldsForKind('ART').map((f) => f.key);
    expect(keys).toEqual(['title', 'tags', 'source', 'provides_context_for', 'root']);
  });

  test('a Feedback kind (FB) exposes source/customer/informs/root', () => {
    const keys = frontmatterFieldsForKind('FB').map((f) => f.key);
    expect(keys).toEqual(['title', 'tags', 'source', 'customer', 'informs', 'root']);
  });

  test('a Business Case (BC) exposes title/tags/justified_by -- without it there is nowhere in the UI to say what justifies it (WO-557)', () => {
    const keys = frontmatterFieldsForKind('BC').map((f) => f.key);
    expect(keys).toEqual(['title', 'tags', 'justified_by']);
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('implements');
  });

  test('a work order (WO) has no frontmatter form fields at all (never authored via the editor)', () => {
    expect(frontmatterFieldsForKind('WO')).toEqual([]);
  });
});

describe('validateFrontmatterFields', () => {
  test('valid fields produce no issues', () => {
    const issues = validateFrontmatterFields('PRD', { title: 'A real title', tags: ['saas'], implements: [], evolves_from: [], justified_by: [] });
    expect(issues).toEqual([]);
  });

  test('an empty title is reported against the "title" field', () => {
    const issues = validateFrontmatterFields('PRD', { title: '', tags: [] });
    expect(issues.some((i) => i.field === 'title')).toBe(true);
  });

  test('a blueprint with zero architects is reported ("must architect at least one feature")', () => {
    const issues = validateFrontmatterFields('SDD', { title: 'A blueprint', tags: [], architects: [], impacts_paths: [] });
    expect(issues.some((i) => i.field === 'architects')).toBe(true);
  });

  test('an id in a relation field that does not look like KIND-NNN is reported', () => {
    const issues = validateFrontmatterFields('PRD', { title: 'ok', tags: [], implements: ['not-an-id'], evolves_from: [], justified_by: [] });
    expect(issues.some((i) => i.field === 'implements')).toBe(true);
  });

  test('never surfaces an issue on a synthetic server-managed field (id/type), even though the schema requires them', () => {
    const issues = validateFrontmatterFields('PRD', { title: 'ok', tags: [] });
    expect(issues.every((i) => i.field !== 'id' && i.field !== 'type')).toBe(true);
  });

  test('a BC validates against its own schema: a bad id in justified_by is reported, a good one is not', () => {
    expect(validateFrontmatterFields('BC', { title: 'ok', tags: [], justified_by: ['not-an-id'] }).some((i) => i.field === 'justified_by')).toBe(true);
    expect(validateFrontmatterFields('BC', { title: 'ok', tags: [], justified_by: ['FB-026'] })).toEqual([]);
  });

  test('a kind with no schema mapping (WO) never produces issues', () => {
    expect(validateFrontmatterFields('WO', { title: 'anything' })).toEqual([]);
  });
});
