import { describe, expect, test } from 'vitest';
import { validateDraft } from '../../src/authoring/validate.js';
import type { DraftRecord } from '../../src/authoring/draft-store.js';
import type { DraftContent } from '../../src/authoring/types.js';
import type { ScanResult } from '../../src/parser/scan.js';
import { sha256 } from '../../src/util/hash.js';
import { doc, mrd, prd, sdd } from '@prdm/testkit';

const art = () => doc('id: ART-001\ntype: ART\ntitle: Call notes\nprovides_context_for: [PRD-001]', 'notes');
const bcApproved = () => doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: approved', '## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n');

/** Mirrors @prdm/testkit's `doc()` raw-file construction so tests can compute the same "raw bytes" hash `openUpdate`/`validateDraft` compare (WO-023 finding 5). */
const rawHashOf = (frontmatter: string, body = 'body'): string => sha256(`---\n${frontmatter.trim()}\n---\n${body}\n`);

const emptyScan = (): ScanResult => ({ docs: [], errors: [], ids: [] });

function makeRecord(content: DraftContent, overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'drf_test0000000000000000',
    mode: 'create',
    targetId: `${content.kind}-?`,
    kind: content.kind,
    content,
    revision: 0,
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

describe('validateDraft: schema', () => {
  test('flags a document missing a required field as a schema issue', () => {
    const record = makeRecord({ kind: 'SDD', title: 'Design', body: 'body' }); // blueprintSchema requires architects
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'schema', severity: 'error' })]));
  });

  test('a well-formed draft has no issues', () => {
    // WO-448/SDD-025 widened the BC gate to FR, so this FR draft must resolve to an approved BC, not a
    // plain ART, for the "well-formed" expectation (zero issues) to hold.
    const record = makeRecord({ kind: 'FR', title: 'New capability', body: 'body', fields: { evolves_from: ['PRD-001'], justified_by: ['BC-001'] } });
    const outcome = validateDraft(record, { scan: { docs: [prd(), bcApproved()], errors: [], ids: ['PRD-001', 'BC-001'] }, grandfathered: [] });
    expect(outcome.issues).toEqual([]);
  });
});

describe('validateDraft: link checks', () => {
  test('flags a broken link to a missing document', () => {
    const record = makeRecord({ kind: 'FR', title: 'New capability', body: 'body', fields: { evolves_from: ['MRD-999'] } });
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'broken_link', message: expect.stringContaining('MRD-999') })]));
  });

  test('flags a link to a document of the wrong label', () => {
    const record = makeRecord({ kind: 'FR', title: 'New capability', body: 'body', fields: { evolves_from: ['SDD-001'] } });
    const outcome = validateDraft(record, { scan: { docs: [prd(), sdd()], errors: [], ids: ['PRD-001', 'SDD-001'] }, grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_link_target' })]));
  });
});

describe('validateDraft: draft_dependency', () => {
  test('flags a reference to another uncommitted draft as blocking', () => {
    const record = makeRecord({ kind: 'FR', title: 'New capability', body: 'body', fields: { evolves_from: ['drf_someOtherDraft1234'] } });
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'draft_dependency', field: 'evolves_from' })]));
    // the draft reference must not also surface as a broken_link (it was extracted before the id-shaped check)
    expect(outcome.issues.some((i) => i.code === 'broken_link')).toBe(false);
  });

  test('flags a reference to another create-mode draft placeholder id', () => {
    const record = makeRecord({ kind: 'FR', title: 'New capability', body: 'body', fields: { evolves_from: ['PRD-?'] } });
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'draft_dependency' })]));
  });
});

describe('validateDraft: stale_base', () => {
  test('flags an update draft whose base document changed on disk since it was opened', () => {
    const current = mrd();
    const record = makeRecord(
      { kind: 'MRD', title: current.node.title, body: 'updated body' },
      { mode: 'update', targetId: 'MRD-001', basePath: current.node.sourcePath, baseHash: 'stale-hash-not-matching' },
    );
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [], currentRawHash: rawHashOf('id: MRD-001\ntype: MRD\ntitle: Market', 'market') });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
  });

  test('an update draft whose base is unchanged (same raw bytes) has no stale_base issue', () => {
    const current = mrd();
    const raw = rawHashOf('id: MRD-001\ntype: MRD\ntitle: Market', 'market');
    const record = makeRecord({ kind: 'MRD', title: current.node.title, body: 'updated body' }, { mode: 'update', targetId: 'MRD-001', basePath: current.node.sourcePath, baseHash: raw });
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [], currentRawHash: raw });
    expect(outcome.issues.some((i) => i.code === 'stale_base')).toBe(false);
  });

  test('flags a stale update whose target document was removed entirely', () => {
    const current = mrd();
    const raw = rawHashOf('id: MRD-001\ntype: MRD\ntitle: Market', 'market');
    const record = makeRecord({ kind: 'MRD', title: 'x', body: 'y' }, { mode: 'update', targetId: 'MRD-001', baseHash: raw });
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [], currentRawHash: raw });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
  });

  test('flags stale even when contentHash would have missed it: only status/tasks changed on disk (WO-023 finding 5)', () => {
    // MRD's contentHash omits volatile fields, so a status-only edit never changes it; the raw-bytes hash must still catch it.
    const current = mrd();
    const openedRaw = rawHashOf('id: MRD-001\ntype: MRD\ntitle: Market', 'market');
    const editedRaw = rawHashOf('id: MRD-001\ntype: MRD\ntitle: Market\nstatus: approved', 'market');
    expect(editedRaw).not.toBe(openedRaw);
    const record = makeRecord({ kind: 'MRD', title: current.node.title, body: 'updated body' }, { mode: 'update', targetId: 'MRD-001', basePath: current.node.sourcePath, baseHash: openedRaw });
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [], currentRawHash: editedRaw });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
  });

  test('treats an unreadable current file (currentRawHash undefined) as stale rather than trusting it', () => {
    const current = mrd();
    const record = makeRecord(
      { kind: 'MRD', title: current.node.title, body: 'updated body' },
      { mode: 'update', targetId: 'MRD-001', basePath: current.node.sourcePath, baseHash: rawHashOf('id: MRD-001\ntype: MRD\ntitle: Market', 'market') },
    );
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [] }); // no currentRawHash provided
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
  });
});

describe('validateDraft: forbidden-field injection (WO-023 finding 6)', () => {
  test('a crafted field key that would render as an extra frontmatter line is rejected before it can smuggle a forbidden field', () => {
    const record = makeRecord({ kind: 'FB', title: 'x', body: 'y', fields: { 'tags: []\nstatus': 'closed' } });
    expect(() => validateDraft(record, { scan: emptyScan(), grandfathered: [] })).toThrow(/invalid frontmatter field key/);
  });

  test('the post-render diff independently flags a forbidden field change on the actual parsed frontmatter, as a second layer behind the pre-render key check', () => {
    const current = doc('id: PRD-001\ntype: PRD\ntitle: Product\nassigned_to: "agent:owner"', 'body', 'docs/prd/PRD-001.md');
    const raw = rawHashOf('id: PRD-001\ntype: PRD\ntitle: Product\nassigned_to: "agent:owner"', 'body');
    const record = makeRecord(
      { kind: 'PRD', title: 'Product', body: 'new body', fields: { assigned_to: 'agent:attacker' } },
      { mode: 'update', targetId: 'PRD-001', basePath: 'docs/prd/PRD-001.md', baseHash: raw, baseFrontmatter: current.frontmatter as unknown as Record<string, unknown> },
    );
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['PRD-001'] }, grandfathered: [], currentRawHash: raw });
    // Both layers fire on the same field: this asserts the post-render one is genuinely there (deduped to one issue), not just the pre-render one.
    expect(outcome.issues.filter((i) => i.code === 'forbidden_field' && i.field === 'assigned_to')).toHaveLength(1);
  });

  test('an update draft that leaves a pre-existing forbidden field untouched is not flagged (no false positive on carried-over values)', () => {
    // blueprint_hashes is forbidden to set from a draft, but a blueprint legitimately carries one after WO generation acknowledges it.
    const frontmatter = 'id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/x/**"]\nblueprint_hashes: {"WO-001":"abc"}';
    const body = 'design\n\n## Tareas\n- [x] done\n';
    const current = doc(frontmatter, body, 'docs/blueprints/SDD-001.md');
    const raw = rawHashOf(frontmatter, body);
    const record = makeRecord(
      { kind: 'SDD', title: 'Design (edited)', body: 'design edited\n\n## Tareas\n- [x] done', fields: { architects: ['PRD-001'], impacts_paths: ['src/x/**'] } },
      { mode: 'update', targetId: 'SDD-001', basePath: 'docs/blueprints/SDD-001.md', baseHash: raw },
    );
    const outcome = validateDraft(record, { scan: { docs: [current, prd()], errors: [], ids: ['SDD-001', 'PRD-001'] }, grandfathered: [], currentRawHash: raw });
    expect(outcome.issues.some((i) => i.code === 'forbidden_field')).toBe(false);
  });
});

describe('validateDraft: lifecycle collateral damage (WO-023 finding 7)', () => {
  test('an update that drops a Feedback\'s "informs" link is blocked when it would unjustify a Feature that relied on it', () => {
    const feature = prd(); // PRD-001, no justified_by of its own
    const fb = doc('id: FB-001\ntype: FB\ntitle: Feedback\nsource: email\nstatus: triaged\ninforms: [PRD-001]', 'feedback', 'docs/feedback/FB-001.md');
    const raw = rawHashOf('id: FB-001\ntype: FB\ntitle: Feedback\nsource: email\nstatus: triaged\ninforms: [PRD-001]', 'feedback');
    const record = makeRecord(
      { kind: 'FB', title: 'Feedback', body: 'feedback', fields: { source: 'email', status: 'triaged', informs: [] } },
      { mode: 'update', targetId: 'FB-001', basePath: 'docs/feedback/FB-001.md', baseHash: raw },
    );
    const outcome = validateDraft(record, { scan: { docs: [feature, fb], errors: [], ids: ['PRD-001', 'FB-001'] }, grandfathered: [], currentRawHash: raw });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'lifecycle', message: expect.stringContaining('PRD-001') })]));
  });

  test('an update that keeps every other document justified introduces no lifecycle issue', () => {
    const feature = prd();
    const art1 = art();
    const fb = doc('id: FB-001\ntype: FB\ntitle: Feedback\nsource: email\nstatus: triaged\ninforms: [PRD-001]', 'feedback', 'docs/feedback/FB-001.md');
    const raw = rawHashOf('id: FB-001\ntype: FB\ntitle: Feedback\nsource: email\nstatus: triaged\ninforms: [PRD-001]', 'feedback');
    const record = makeRecord(
      { kind: 'FB', title: 'Feedback (edited)', body: 'feedback edited', fields: { source: 'email', status: 'triaged', informs: ['PRD-001'] } },
      { mode: 'update', targetId: 'FB-001', basePath: 'docs/feedback/FB-001.md', baseHash: raw },
    );
    const outcome = validateDraft(record, { scan: { docs: [feature, art1, fb], errors: [], ids: ['PRD-001', 'ART-001', 'FB-001'] }, grandfathered: [], currentRawHash: raw });
    expect(outcome.issues.some((i) => i.code === 'lifecycle')).toBe(false);
  });
});

describe('validateDraft: forbidden fields', () => {
  test('surfaces forbidden_field issues from the draft content', () => {
    const record = makeRecord({ kind: 'FB', title: 'x', body: 'y', fields: { assigned_to: 'agent:x' } });
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'forbidden_field', field: 'assigned_to' })]));
  });
});

describe('validateDraft: rendering', () => {
  test('shows a create draft id as the KIND-? placeholder, never the internal synthetic id', () => {
    const record = makeRecord({ kind: 'FB', title: 'Customer feedback', body: 'body text', fields: { informs: ['PRD-001'] } });
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.rendered).toContain('"FB-?"');
    expect(outcome.rendered).not.toMatch(/FB-0{9}/);
    expect(outcome.targetPath).toBeNull();
  });

  test('an update draft carries forward its base path as targetPath', () => {
    const current = doc('id: FB-001\ntype: FB\ntitle: x\nsource: email', 'body', 'docs/feedback/FB-001.md');
    const record = makeRecord({ kind: 'FB', title: 'x', body: 'y' }, { mode: 'update', targetId: 'FB-001', basePath: 'docs/feedback/FB-001.md', baseHash: current.node.contentHash });
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['FB-001'] }, grandfathered: [] });
    expect(outcome.targetPath).toBe('docs/feedback/FB-001.md');
  });
});
