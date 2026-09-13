import { describe, expect, test } from 'vitest';
import { validateDraft } from '../../src/authoring/validate.js';
import type { DraftRecord } from '../../src/authoring/draft-store.js';
import type { DraftContent } from '../../src/authoring/types.js';
import type { ScanResult } from '../../src/parser/scan.js';
import { doc, mrd, prd, sdd } from '@prdm/testkit';

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
    const record = makeRecord({ kind: 'FR', title: 'New capability', body: 'body', fields: { evolves_from: ['PRD-001'] } });
    const outcome = validateDraft(record, { scan: { docs: [prd()], errors: [], ids: ['PRD-001'] }, grandfathered: [] });
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
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
  });

  test('an update draft whose base is unchanged has no stale_base issue', () => {
    const current = mrd();
    const record = makeRecord(
      { kind: 'MRD', title: current.node.title, body: 'updated body' },
      { mode: 'update', targetId: 'MRD-001', basePath: current.node.sourcePath, baseHash: current.node.contentHash },
    );
    const outcome = validateDraft(record, { scan: { docs: [current], errors: [], ids: ['MRD-001'] }, grandfathered: [] });
    expect(outcome.issues.some((i) => i.code === 'stale_base')).toBe(false);
  });

  test('flags a stale update whose target document was removed entirely', () => {
    const current = mrd();
    const record = makeRecord({ kind: 'MRD', title: 'x', body: 'y' }, { mode: 'update', targetId: 'MRD-001', baseHash: current.node.contentHash });
    const outcome = validateDraft(record, { scan: emptyScan(), grandfathered: [] });
    expect(outcome.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale_base' })]));
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
    const record = makeRecord({ kind: 'FB', title: 'Customer feedback', body: 'body text' });
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
