import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { checkLifecycle, type LifecycleContext } from '../../src/lifecycle/check.js';

const noGrandfathering: LifecycleContext = { grandfathered: [] };

const mrd = (extra = ''): ParsedDoc => doc(`id: MRD-001\ntype: MRD\ntitle: Market\n${extra}`);
const prd = (extra = ''): ParsedDoc => doc(`id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]\n${extra}`);
const fr = (extra = ''): ParsedDoc => doc(`id: FR-001\ntype: FR\ntitle: Request\n${extra}`);
const sdd = (extra = '', body = 'design'): ParsedDoc => doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\n${extra}`, body);
const wo = (extra = ''): ParsedDoc => doc(`id: WO-001\ntype: WO\ntitle: Task\nimplements: [SDD-001]\n${extra}`);
const fb = (extra = '', status = 'new'): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\nstatus: ${status}\n${extra}`);
const art = (extra = ''): ParsedDoc => doc(`id: ART-001\ntype: ART\ntitle: Note\n${extra}`);
const BC_ALL_SECTIONS = '## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n';
const bc = (extra = '', body = BC_ALL_SECTIONS): ParsedDoc => doc(`id: BC-001\ntype: BC\ntitle: Business case\n${extra}`, body);

function kinds(issues: ReturnType<typeof checkLifecycle>): [string, string, string][] {
  return issues.map((i) => [i.kind, i.severity, i.nodeId]);
}

describe('checkLifecycle — Feedback', () => {
  test('untriaged (no informs, no root) is a warning while status is "new"', () => {
    const issues = checkLifecycle([fb()], noGrandfathering);
    expect(kinds(issues)).toEqual([['lifecycle_violation', 'warning', 'FB-001']]);
    expect(issues[0]?.message).toMatch(/triag|informs|root/i);
  });

  test('unlinked feedback past triage (status != new) is an error', () => {
    const issues = checkLifecycle([fb('', 'triaged')], noGrandfathering);
    expect(kinds(issues)).toEqual([['lifecycle_violation', 'error', 'FB-001']]);
  });

  test('root: true exempts feedback from linking', () => {
    expect(checkLifecycle([fb('root: true')], noGrandfathering)).toEqual([]);
  });

  test('informs satisfies the rule', () => {
    expect(checkLifecycle([fb('informs: [PRD-001]'), prd()], noGrandfathering).filter((i) => i.nodeId === 'FB-001')).toEqual([]);
  });
});

describe('checkLifecycle — Artifact', () => {
  test('no provides_context_for and no root is an error', () => {
    expect(kinds(checkLifecycle([art()], noGrandfathering))).toEqual([['lifecycle_violation', 'error', 'ART-001']]);
  });

  test('root: true exempts an artifact from linking', () => {
    expect(checkLifecycle([art('root: true')], noGrandfathering)).toEqual([]);
  });

  test('provides_context_for satisfies the rule', () => {
    expect(checkLifecycle([art('provides_context_for: [PRD-001]'), prd()], noGrandfathering).filter((i) => i.nodeId === 'ART-001')).toEqual([]);
  });
});

describe('checkLifecycle — Feature (MRD unchanged by WO-439/SDD-025)', () => {
  test('MRD with no justification (and no root exemption, unlike FB/ART) is an error', () => {
    expect(kinds(checkLifecycle([mrd()], noGrandfathering))).toEqual([['lifecycle_violation', 'error', 'MRD-001']]);
  });

  test('an explicit justified_by satisfies the rule even before the id is validated to exist (linkIssues owns that)', () => {
    expect(checkLifecycle([mrd('justified_by: [FB-999]')], noGrandfathering)).toEqual([]);
  });

  test('a reverse INFORMS from an existing Feedback derives JUSTIFIED_BY', () => {
    const docs = [mrd(), fb('informs: [MRD-001]')];
    expect(checkLifecycle(docs, noGrandfathering).filter((i) => i.nodeId === 'MRD-001')).toEqual([]);
  });

  test('MRD is unaffected by SDD-025 widening the BC gate to FR: any justified_by (FB/ART) still satisfies it', () => {
    expect(checkLifecycle([mrd('justified_by: [FB-999]')], noGrandfathering)).toEqual([]);
  });
});

const bcApproved = (id = 'BC-001'): ParsedDoc => doc(`id: ${id}\ntype: BC\ntitle: Business case\nstatus: approved`, BC_ALL_SECTIONS);

describe('checkLifecycle — PRD/FR need an approved BC (WO-439, widened to FR by WO-448/SDD-025)', () => {
  test('PRD with no justification at all: names the BC requirement specifically', () => {
    const issues = checkLifecycle([prd()], noGrandfathering);
    expect(kinds(issues)).toEqual([['lifecycle_violation', 'error', 'PRD-001']]);
    expect(issues[0]?.message).toContain('BC');
  });

  test('PRD justified by an FB (not a BC) is still an error, distinct message from "no justification"', () => {
    const issues = checkLifecycle([prd('justified_by: [FB-999]')], noGrandfathering);
    expect(kinds(issues)).toEqual([['lifecycle_violation', 'error', 'PRD-001']]);
    expect(issues[0]?.message).toMatch(/justified.*not by a BC/);
  });

  test('PRD justified via reverse PROVIDES_CONTEXT_FOR from an Artifact (no BC) is still an error, not silently exempt like FR', () => {
    const docs = [prd(), art('provides_context_for: [PRD-001]')];
    expect(checkLifecycle(docs, noGrandfathering).filter((i) => i.nodeId === 'PRD-001')).toHaveLength(1);
  });

  test('PRD justified by a BC that is not yet approved (draft) is an error naming the BC and its status', () => {
    const draftBc = doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: draft', BC_ALL_SECTIONS);
    const issues = checkLifecycle([prd('justified_by: [BC-001]'), draftBc], noGrandfathering);
    expect(kinds(issues.filter((i) => i.nodeId === 'PRD-001'))).toEqual([['lifecycle_violation', 'error', 'PRD-001']]);
    expect(issues.find((i) => i.nodeId === 'PRD-001')?.message).toContain('BC-001');
  });

  test('PRD justified by an approved BC satisfies the rule', () => {
    const issues = checkLifecycle([prd('justified_by: [BC-001]'), bcApproved()], noGrandfathering);
    expect(issues.filter((i) => i.nodeId === 'PRD-001')).toEqual([]);
  });

  test('PRD justified by a closed BC also satisfies the rule', () => {
    const closedBc = doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: closed', BC_ALL_SECTIONS);
    const issues = checkLifecycle([prd('justified_by: [BC-001]'), closedBc], noGrandfathering);
    expect(issues.filter((i) => i.nodeId === 'PRD-001')).toEqual([]);
  });

  test('PRD justified_by lists several ids: only one needs to resolve to an approved BC', () => {
    const issues = checkLifecycle([prd('justified_by: [FB-999, BC-001]'), bcApproved()], noGrandfathering);
    expect(issues.filter((i) => i.nodeId === 'PRD-001')).toEqual([]);
  });

  test('FR with no justification at all: names the BC requirement specifically, same as PRD', () => {
    const issues = checkLifecycle([fr()], noGrandfathering);
    expect(kinds(issues)).toEqual([['lifecycle_violation', 'error', 'FR-001']]);
    expect(issues[0]?.message).toContain('BC');
  });

  test('FR justified by an FB (not a BC) is still an error, distinct message from "no justification"', () => {
    const issues = checkLifecycle([fr('justified_by: [FB-999]')], noGrandfathering);
    expect(issues[0]?.message).toMatch(/justified.*not by a BC/);
  });

  test('FR justified via reverse PROVIDES_CONTEXT_FOR from an Artifact (no BC) is still an error, no longer silently exempt', () => {
    const docs = [fr(), art('provides_context_for: [FR-001]')];
    expect(checkLifecycle(docs, noGrandfathering).filter((i) => i.nodeId === 'FR-001')).toHaveLength(1);
  });

  test('FR justified by a BC that is not yet approved (draft) is an error naming the BC and its status', () => {
    const draftBc = doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: draft', BC_ALL_SECTIONS);
    const issues = checkLifecycle([fr('justified_by: [BC-001]'), draftBc], noGrandfathering);
    expect(kinds(issues.filter((i) => i.nodeId === 'FR-001'))).toEqual([['lifecycle_violation', 'error', 'FR-001']]);
  });

  test('FR justified by an approved BC satisfies the rule', () => {
    const issues = checkLifecycle([fr('justified_by: [BC-001]'), bcApproved()], noGrandfathering);
    expect(issues.filter((i) => i.nodeId === 'FR-001')).toEqual([]);
  });
});

describe('checkLifecycle — BusinessCase (BC)', () => {
  test('no justification and all four sections present is still an error (justification)', () => {
    expect(kinds(checkLifecycle([bc()], noGrandfathering))).toEqual([['lifecycle_violation', 'error', 'BC-001']]);
  });

  test('justified_by satisfies the justification half of the rule, same as MRD/PRD/FR', () => {
    expect(checkLifecycle([bc('justified_by: [FB-999]')], noGrandfathering)).toEqual([]);
  });

  test('a reverse INFORMS from an existing Feedback derives JUSTIFIED_BY, same as a Feature', () => {
    const docs = [bc(), fb('informs: [BC-001]')];
    expect(checkLifecycle(docs, noGrandfathering).filter((i) => i.nodeId === 'BC-001')).toEqual([]);
  });

  test('missing one of the four required sections is an error naming it', () => {
    const missingCost = 'justified_by: [FB-999]';
    const body = '## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n';
    const issues = checkLifecycle([bc(missingCost, body)], noGrandfathering);
    expect(kinds(issues)).toEqual([['lifecycle_violation', 'error', 'BC-001']]);
    expect(issues[0]?.message).toContain('Costo estimado');
  });

  test('missing several sections lists all of them', () => {
    const issues = checkLifecycle([bc('justified_by: [FB-999]', '## Problema\n')], noGrandfathering);
    expect(issues[0]?.message).toContain('Impacto esperado');
    expect(issues[0]?.message).toContain('Métrica de éxito');
    expect(issues[0]?.message).toContain('Costo estimado');
  });

  test('justified_by + all four sections satisfies the rule with zero issues (no impacts_paths/Tareas required: not a blueprint)', () => {
    expect(checkLifecycle([bc('justified_by: [FB-999]')], noGrandfathering)).toEqual([]);
  });
});

const approvedPrd = (): ParsedDoc => prd('justified_by: [ART-001]\nstatus: approved');
const blueprintIssuesOf = (issues: ReturnType<typeof checkLifecycle>): [string, string, string][] => kinds(issues).filter(([, , id]) => id === 'SDD-001');

describe('checkLifecycle — Blueprint (SDD/ADR)', () => {
  test('missing impacts_paths is an error', () => {
    const issues = checkLifecycle([approvedPrd(), sdd('', '## Tareas\n- [ ] a')], noGrandfathering);
    expect(blueprintIssuesOf(issues)).toEqual([['lifecycle_violation', 'error', 'SDD-001']]);
  });

  test('impacts_paths without a Tareas/Tasks checklist is an error', () => {
    const issues = checkLifecycle([approvedPrd(), sdd('impacts_paths: ["src/**"]', 'no checklist here')], noGrandfathering);
    expect(blueprintIssuesOf(issues)).toEqual([['lifecycle_violation', 'error', 'SDD-001']]);
  });

  test('impacts_paths + a non-empty Tareas checklist satisfies the design rule', () => {
    const issues = checkLifecycle([approvedPrd(), sdd('impacts_paths: ["src/**"]', '## Tareas\n- [ ] do it')], noGrandfathering);
    expect(blueprintIssuesOf(issues)).toEqual([]);
  });

  test('architecting a feature that is not approved/closed is a design_before_approval warning', () => {
    const issues = checkLifecycle([prd('justified_by: [ART-001]'), sdd('impacts_paths: ["src/**"]', '## Tareas\n- [x] done')], noGrandfathering);
    expect(blueprintIssuesOf(issues)).toEqual([['lifecycle_violation', 'warning', 'SDD-001']]);
  });

  test('"## Tasks" (English) with a checklist also satisfies the rule', () => {
    const issues = checkLifecycle([approvedPrd(), sdd('impacts_paths: ["src/**"]', '## Tasks\n- [ ] do it')], noGrandfathering);
    expect(blueprintIssuesOf(issues)).toEqual([]);
  });
});

describe('checkLifecycle — Work Order', () => {
  test('missing source_task is an error', () => {
    expect(kinds(checkLifecycle([wo()], noGrandfathering))).toEqual([['lifecycle_violation', 'error', 'WO-001']]);
  });

  test('source_task satisfies the rule', () => {
    expect(checkLifecycle([wo('source_task: abc123')], noGrandfathering)).toEqual([]);
  });
});

describe('checkLifecycle — grandfathering', () => {
  test('a listed id with a matching hash is fully exempt', () => {
    const doc1 = mrd();
    const ctx: LifecycleContext = { grandfathered: [{ id: 'MRD-001', hash: doc1.node.contentHash }] };
    expect(checkLifecycle([doc1], ctx)).toEqual([]);
  });

  test('a listed id whose hash no longer matches emits a lapse warning and then the rule applies', () => {
    const doc1 = mrd();
    const ctx: LifecycleContext = { grandfathered: [{ id: 'MRD-001', hash: 'stale-hash' }] };
    const issues = checkLifecycle([doc1], ctx);
    expect(kinds(issues)).toEqual([
      ['lifecycle_violation', 'warning', 'MRD-001'],
      ['lifecycle_violation', 'error', 'MRD-001'],
    ]);
    expect(issues[0]?.message).toMatch(/grandfathering lapsed/i);
  });

  test('an unlisted id is unaffected by an unrelated grandfathered entry', () => {
    const ctx: LifecycleContext = { grandfathered: [{ id: 'MRD-404', hash: 'x' }] };
    expect(kinds(checkLifecycle([mrd()], ctx))).toEqual([['lifecycle_violation', 'error', 'MRD-001']]);
  });

  test('WO-440: a PRD with no BC, but grandfathered with its current hash, emits zero issues', () => {
    const legacyPrd = prd('justified_by: [ART-001]');
    const ctx: LifecycleContext = { grandfathered: [{ id: 'PRD-001', hash: legacyPrd.node.contentHash }] };
    expect(checkLifecycle([legacyPrd], ctx)).toEqual([]);
  });

  test('WO-440: once the grandfathered PRD\'s content changes, the exemption lapses and the BC gate applies again', () => {
    const legacyPrd = prd('justified_by: [ART-001]');
    const ctx: LifecycleContext = { grandfathered: [{ id: 'PRD-001', hash: 'stale-hash' }] };
    const issues = checkLifecycle([legacyPrd], ctx);
    expect(issues[0]?.message).toMatch(/grandfathering lapsed/i);
    expect(issues[1]).toMatchObject({ kind: 'lifecycle_violation', severity: 'error', nodeId: 'PRD-001' });
    expect(issues[1]?.message).toContain('BC');
  });
});
