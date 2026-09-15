import { describe, expect, test } from 'vitest';
import { validateDocument } from '../../src/authoring/validate-document.js';
import type { ScanResult } from '../../src/parser/scan.js';
import { sha256 } from '../../src/util/hash.js';
import { doc, mrd, prd, sdd } from '@prdm/testkit';

const rawHashOf = (frontmatter: string, body = 'body'): string => sha256(`---\n${frontmatter.trim()}\n---\n${body}\n`);

const emptyScan = (): ScanResult => ({ docs: [], errors: [], ids: [] });

describe('validateDocument: schema', () => {
  test('flags a document missing a required field as a schema issue', () => {
    const outcome = validateDocument({ kind: 'SDD', title: 'Design', body: 'body', id: 'SDD-001', mode: 'edit' }, { scan: emptyScan(), grandfathered: [] }); // blueprintSchema requires architects
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'schema', severity: 'error' })]));
  });

  test('a well-formed document has no issues in either mode', () => {
    const fb = doc('id: FB-001\ntype: FB\ntitle: Feedback\nsource: email\nstatus: triaged', 'feedback', 'docs/feedback/FB-001.md');
    const input = { kind: 'FR' as const, title: 'New capability', body: 'body', id: 'FR-001', fields: { evolves_from: ['PRD-001'], justified_by: ['FB-001'] } };
    const fr = doc('id: FR-001\ntype: FR\ntitle: New capability\nevolves_from: [PRD-001]\njustified_by: [FB-001]', 'body', 'docs/fr/FR-001.md');
    const scan: ScanResult = { docs: [prd(), fb, fr], errors: [], ids: ['PRD-001', 'FB-001', 'FR-001'] };
    expect(validateDocument({ ...input, mode: 'edit' }, { scan, grandfathered: [] }).issues).toEqual([]);
    expect(validateDocument({ ...input, mode: 'publish' }, { scan, grandfathered: [] }).issues).toEqual([]);
  });

  test('existence is checked against scan.ids, not only scan.docs: an unpublished draft (id reserved, no parsed content yet) is not treated as stale', () => {
    // PgProjectEngine.scan() only parses PUBLISHED content into `docs`, but `ids` covers every doc_id in any state (SDD-007).
    const outcome = validateDocument(
      { kind: 'FB', title: 'x', body: 'y', id: 'FB-001', mode: 'edit', fields: { root: true } },
      { scan: { docs: [], errors: [], ids: ['FB-001'] }, grandfathered: [] },
    );
    expect(outcome.issues.some((i) => i.code === 'stale_base')).toBe(false);
    expect(outcome.targetPath).toBeNull();
  });

  test('never uses a synthetic id: the rendered id is always the real one passed in', () => {
    const outcome = validateDocument({ kind: 'FB', title: 'x', body: 'y', id: 'FB-042', mode: 'edit' }, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.rendered).toContain('FB-042');
    expect(outcome.internalId).toBe('FB-042');
  });
});

describe('validateDocument: link checks differ by mode', () => {
  test('a broken link is only a warning in edit mode (the target may simply not be published yet)', () => {
    const outcome = validateDocument({ kind: 'FR', title: 'New capability', body: 'body', id: 'FR-001', mode: 'edit', fields: { evolves_from: ['MRD-999'] } }, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'broken_link', severity: 'warning' })]));
  });

  test('the same broken link blocks in publish mode', () => {
    const outcome = validateDocument({ kind: 'FR', title: 'New capability', body: 'body', id: 'FR-001', mode: 'publish', fields: { evolves_from: ['MRD-999'] } }, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'broken_link', severity: 'error' })]));
  });

  test('a link to the wrong label is a warning in edit mode, an error in publish mode', () => {
    const scan: ScanResult = { docs: [prd(), sdd()], errors: [], ids: ['PRD-001', 'SDD-001'] };
    const editOutcome = validateDocument({ kind: 'FR', title: 'New capability', body: 'body', id: 'FR-001', mode: 'edit', fields: { evolves_from: ['SDD-001'] } }, { scan, grandfathered: [] });
    expect(editOutcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_link_target', severity: 'warning' })]));

    const publishOutcome = validateDocument({ kind: 'FR', title: 'New capability', body: 'body', id: 'FR-001', mode: 'publish', fields: { evolves_from: ['SDD-001'] } }, { scan, grandfathered: [] });
    expect(publishOutcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_link_target', severity: 'error' })]));
  });
});

describe('validateDocument: stale_base', () => {
  test('flags an edit whose base document changed since it was opened', () => {
    const current = mrd();
    const outcome = validateDocument(
      { kind: 'MRD', title: current.node.title, body: 'updated body', id: 'MRD-001', mode: 'edit', baseHash: 'stale-hash-not-matching' },
      { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [] },
    );
    // currentRawHash omitted (unreadable) is also treated as stale, but here we pass a mismatching one explicitly via baseHash vs the implicit undefined currentRawHash.
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
  });

  test('no stale_base issue when currentRawHash matches baseHash', () => {
    const current = mrd();
    const raw = rawHashOf('id: MRD-001\ntype: MRD\ntitle: Market', 'market');
    const outcome = validateDocument(
      { kind: 'MRD', title: current.node.title, body: 'updated body', id: 'MRD-001', mode: 'edit', baseHash: raw, currentRawHash: raw },
      { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [] },
    );
    expect(outcome.issues.some((i) => i.code === 'stale_base')).toBe(false);
  });

  test('baseHash omitted entirely skips the staleness check', () => {
    const current = mrd();
    const outcome = validateDocument({ kind: 'MRD', title: current.node.title, body: 'updated body', id: 'MRD-001', mode: 'edit' }, { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [] });
    expect(outcome.issues.some((i) => i.code === 'stale_base')).toBe(false);
  });

  test('flags a document that no longer exists at all', () => {
    const outcome = validateDocument({ kind: 'MRD', title: 'x', body: 'y', id: 'MRD-001', mode: 'edit' }, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
  });
});

describe('validateDocument: forbidden-field injection', () => {
  test('re-checks forbidden fields on the actual parsed frontmatter against the base document', () => {
    const current = doc('id: PRD-001\ntype: PRD\ntitle: Product\nassigned_to: "agent:owner"', 'body', 'docs/prd/PRD-001.md');
    const outcome = validateDocument(
      { kind: 'PRD', title: 'Product', body: 'new body', id: 'PRD-001', mode: 'edit', fields: { assigned_to: 'agent:attacker' } },
      { scan: { docs: [current], errors: [], ids: ['PRD-001'] }, grandfathered: [] },
    );
    expect(outcome.issues.filter((i) => i.code === 'forbidden_field' && i.field === 'assigned_to')).toHaveLength(1);
  });

  test('a carried-over forbidden field left untouched is not flagged', () => {
    const frontmatter = 'id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/x/**"]\nblueprint_hashes: {"WO-001":"abc"}';
    const body = 'design\n\n## Tareas\n- [x] done\n';
    const current = doc(frontmatter, body, 'docs/blueprints/SDD-001.md');
    const outcome = validateDocument(
      { kind: 'SDD', title: 'Design (edited)', body: 'design edited\n\n## Tareas\n- [x] done', id: 'SDD-001', mode: 'edit', fields: { architects: ['PRD-001'], impacts_paths: ['src/x/**'] } },
      { scan: { docs: [current, prd()], errors: [], ids: ['SDD-001', 'PRD-001'] }, grandfathered: [] },
    );
    expect(outcome.issues.some((i) => i.code === 'forbidden_field')).toBe(false);
  });
});

describe('validateDocument: lifecycle collateral damage', () => {
  test('an edit that drops a Feedback\'s "informs" link is blocked when it would unjustify a Feature that relied on it', () => {
    const feature = prd();
    const fb = doc('id: FB-001\ntype: FB\ntitle: Feedback\nsource: email\nstatus: triaged\ninforms: [PRD-001]', 'feedback', 'docs/feedback/FB-001.md');
    const outcome = validateDocument(
      { kind: 'FB', title: 'Feedback', body: 'feedback', id: 'FB-001', mode: 'edit', fields: { source: 'email', status: 'triaged', informs: [] } },
      { scan: { docs: [feature, fb], errors: [], ids: ['PRD-001', 'FB-001'] }, grandfathered: [] },
    );
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lifecycle', message: expect.stringContaining('PRD-001') })]));
  });
});

describe('validateDocument: rendering', () => {
  test('carries the current document sourcePath forward as targetPath', () => {
    const current = doc('id: FB-001\ntype: FB\ntitle: x\nsource: email', 'body', 'docs/feedback/FB-001.md');
    const outcome = validateDocument({ kind: 'FB', title: 'x', body: 'y', id: 'FB-001', mode: 'edit' }, { scan: { docs: [current], errors: [], ids: ['FB-001'] }, grandfathered: [] });
    expect(outcome.targetPath).toBe('docs/feedback/FB-001.md');
  });

  test('targetPath is null for a document not found in scan (synthetic path used only for parsing)', () => {
    const outcome = validateDocument({ kind: 'FB', title: 'x', body: 'y', id: 'FB-001', mode: 'edit' }, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.targetPath).toBeNull();
  });
});
