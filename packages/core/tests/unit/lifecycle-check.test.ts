import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { BC_REQUIRED_SECTIONS } from '../../src/domain/index.js';
import { checkLifecycle, countPassageExceptions, passageException, passageExceptions, type LifecycleContext } from '../../src/lifecycle/check.js';

const noGrandfathering: LifecycleContext = { grandfathered: [] };

const mrd = (extra = ''): ParsedDoc => doc(`id: MRD-001\ntype: MRD\ntitle: Market\n${extra}`);
const PRD_COMPLETE_BODY = '## Problema\n\n## Alcance\n\n## Personas y trabajos\n\n## Métrica de éxito\n\n## Features derivadas\n';
const FR_COMPLETE_BODY = '## Alcance\n\n## Criterio de aceptación\n\n- [ ] hecho\n';
const prd = (extra = ''): ParsedDoc => doc(`id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]\n${extra}`, PRD_COMPLETE_BODY);
const fr = (extra = ''): ParsedDoc => doc(`id: FR-001\ntype: FR\ntitle: Request\n${extra}`, FR_COMPLETE_BODY);
const sdd = (extra = '', body = 'design'): ParsedDoc => doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\n${extra}`, body);
const wo = (extra = ''): ParsedDoc => doc(`id: WO-001\ntype: WO\ntitle: Task\nimplements: [SDD-001]\n${extra}`);
const fb = (extra = '', status = 'new'): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\nstatus: ${status}\n${extra}`);
const art = (extra = ''): ParsedDoc => doc(`id: ART-001\ntype: ART\ntitle: Note\n${extra}`);
const BC_ALL_SECTIONS = `${BC_REQUIRED_SECTIONS.join('\n\n')}\n`;
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

describe('checkLifecycle — Feedback recorded link/outcome (WO-725 / SDD-096)', () => {
  const fbIssues = (docs: ParsedDoc[]) => checkLifecycle(docs, noGrandfathering).filter((i) => i.nodeId === 'FB-001');

  test('D1: a feedback cited by a justified_by is not a violation', () => {
    expect(fbIssues([fb(), bc('justified_by: [FB-001]')])).toEqual([]);
  });

  test('D2: closed with close_reason + closed_by is resolved', () => {
    expect(fbIssues([fb('close_reason: cerrado por WO-624\nclosed_by: agent:tester', 'closed')])).toEqual([]);
  });

  test('D2: duplicate with duplicate_of is resolved', () => {
    expect(fbIssues([fb('duplicate_of: FB-002', 'duplicate')])).toEqual([]);
  });

  test('D2: dismissed with dismiss_reason is resolved', () => {
    expect(fbIssues([fb('dismiss_reason: no aplica', 'dismissed')])).toEqual([]);
  });

  test('D3: dismissed without dismiss_reason is still an error', () => {
    expect(kinds(fbIssues([fb('', 'dismissed')]))).toEqual([['lifecycle_violation', 'error', 'FB-001']]);
  });

  test('D3: closed without close_reason is still an error', () => {
    expect(kinds(fbIssues([fb('closed_by: agent:tester', 'closed')]))).toEqual([['lifecycle_violation', 'error', 'FB-001']]);
  });

  test('D5: the violation message names every way out', () => {
    const message = fbIssues([fb('', 'triaged')])[0]?.message ?? '';
    expect(message).toMatch(/informs/);
    expect(message).toMatch(/root: true/);
    expect(message).toMatch(/justified_by/);
    expect(message).toMatch(/close_reason/);
    expect(message).toMatch(/duplicate_of/);
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

  test('FR justified by an approved BC alone no longer satisfies R3 (SDD-125): it needs its PRD', () => {
    const issues = checkLifecycle([fr('justified_by: [BC-001]'), bcApproved()], noGrandfathering);
    expect(kinds(issues.filter((i) => i.nodeId === 'FR-001'))).toEqual([['lifecycle_violation', 'warning', 'FR-001']]);
  });
});

const prdApproved = (id = 'PRD-002', status = 'approved'): ParsedDoc =>
  doc(`id: ${id}\ntype: PRD\ntitle: Product\nimplements: [MRD-001]\njustified_by: [BC-001]\nstatus: ${status}`, PRD_COMPLETE_BODY);

describe('checkLifecycle — R3: el FR declara su PRD (WO-806 / SDD-125 D1)', () => {
  const publishCtx: LifecycleContext = { ...noGrandfathering, mode: 'publish' };
  const frIssues = (docs: ParsedDoc[], ctx: LifecycleContext = noGrandfathering) => checkLifecycle(docs, ctx).filter((i) => i.nodeId === 'FR-001');

  test('sin justificación: el mensaje sigue nombrando el BC (gate existente intacto)', () => {
    const issues = frIssues([fr()], publishCtx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('BC');
    expect(issues[0]?.message).not.toContain('PRD');
  });

  test('justificado pero no por un BC: mensaje propio, sin mencionar el PRD (gate existente intacto)', () => {
    const issues = frIssues([fr('justified_by: [FB-999]')], publishCtx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/justified.*not by a BC/);
    expect(issues[0]?.message).not.toContain('PRD');
  });

  test('BC no aprobado: mensaje propio que nombra el BC y su estado (gate existente intacto)', () => {
    const draftBc = doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: draft', BC_ALL_SECTIONS);
    const issues = frIssues([fr('justified_by: [BC-001]'), draftBc], publishCtx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('BC-001');
    expect(issues[0]?.message).toContain('draft');
  });

  test('BC aprobado pero sin PRD: error al publicar que nombra las dos salidas', () => {
    const issues = frIssues([fr('justified_by: [BC-001]'), bcApproved()], publishCtx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.message).toMatch(/justified, but not by a PRD/);
    expect(issues[0]?.message).toContain('"justified_by"');
    expect(issues[0]?.message).toContain('## Excepción de pasaje');
  });

  test('PRD linkeado pero no aprobado: mensaje propio que nombra el PRD y su estado', () => {
    const issues = frIssues([fr('justified_by: [BC-001, PRD-002]'), bcApproved(), prdApproved('PRD-002', 'proposed')], publishCtx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.message).toContain('PRD-002');
    expect(issues[0]?.message).toContain('proposed');
  });

  test('los cinco fracasos del FR son mensajes distintos entre sí', () => {
    const draftBc = doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: draft', BC_ALL_SECTIONS);
    const messages = [
      frIssues([fr()], publishCtx)[0]?.message,
      frIssues([fr('justified_by: [FB-999]')], publishCtx)[0]?.message,
      frIssues([fr('justified_by: [BC-001]'), draftBc], publishCtx)[0]?.message,
      frIssues([fr('justified_by: [BC-001]'), bcApproved()], publishCtx)[0]?.message,
      frIssues([fr('justified_by: [BC-001, PRD-002]'), bcApproved(), prdApproved('PRD-002', 'draft')], publishCtx)[0]?.message,
    ];
    expect(messages.every((m) => typeof m === 'string')).toBe(true);
    expect(new Set(messages).size).toBe(5);
  });

  test('un PRD aprobado en justified_by satisface R3 (publicar)', () => {
    const issues = frIssues([fr('justified_by: [BC-001, PRD-002]'), bcApproved(), prdApproved()], publishCtx);
    expect(issues).toEqual([]);
  });

  test('un PRD cerrado también satisface R3', () => {
    const issues = frIssues([fr('justified_by: [BC-001, PRD-002]'), bcApproved(), prdApproved('PRD-002', 'closed')], publishCtx);
    expect(issues).toEqual([]);
  });

  test('otro tipo (MRD) en justified_by no cuenta como el PRD del FR', () => {
    const mrdDoc = doc('id: MRD-001\ntype: MRD\ntitle: Market\njustified_by: [FB-999]');
    const issues = frIssues([fr('justified_by: [BC-001, MRD-001]'), bcApproved(), mrdDoc], publishCtx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/not by a PRD/);
  });

  test('en edición (drift) la falta de PRD es advertencia; al publicar es error', () => {
    const docs = [fr('justified_by: [BC-001]'), bcApproved()];
    expect(frIssues(docs)).toEqual([{ kind: 'lifecycle_violation', severity: 'warning', nodeId: 'FR-001', message: expect.stringMatching(/not by a PRD/) }]);
    expect(frIssues(docs, publishCtx)).toEqual([{ ...frIssues(docs)[0], severity: 'error' }]);
  });

  test('un PRD no aprobado es advertencia en edición y error al publicar', () => {
    const docs = [fr('justified_by: [BC-001, PRD-002]'), bcApproved(), prdApproved('PRD-002', 'proposed')];
    expect(frIssues(docs)[0]?.severity).toBe('warning');
    expect(frIssues(docs, publishCtx)[0]?.severity).toBe('error');
  });

  test('el PRD no hereda la regla de R3 (sigue exigiendo sólo su BC)', () => {
    const issues = checkLifecycle([prdApproved('PRD-002'), bcApproved()], publishCtx).filter((i) => i.nodeId === 'PRD-002');
    // sanity: la regla nueva sólo aplica a FR; un PRD con su BC aprobado no gana un issue de "not by a PRD"
    expect(issues.filter((i) => /not by a PRD/.test(i.message))).toEqual([]);
  });
});

describe('checkLifecycle — excepción de pasaje declarada (WO-807 / SDD-125 D2)', () => {
  const EXCEPTION_REASON = 'un solo diseño, sin cambios de modelo de datos ni de contrato público';
  const WITH_EXCEPTION = `${FR_COMPLETE_BODY}\n## Excepción de pasaje\n\n${EXCEPTION_REASON}\n`;
  const EXCEPTION_NO_REASON = `${FR_COMPLETE_BODY}\n## Excepción de pasaje\n`;
  const frWithBody = (body: string, extra = 'justified_by: [BC-001]'): ParsedDoc => doc(`id: FR-001\ntype: FR\ntitle: Request\n${extra}`, body);
  const publishCtx: LifecycleContext = { ...noGrandfathering, mode: 'publish' };
  const frIssues = (docs: ParsedDoc[], ctx: LifecycleContext = publishCtx) => checkLifecycle(docs, ctx).filter((i) => i.nodeId === 'FR-001');

  test('sin la sección no hay excepción', () => {
    expect(passageException(frWithBody(FR_COMPLETE_BODY))).toBeNull();
  });

  test('una sección vacía no es una excepción (no hay motivo)', () => {
    expect(passageException(frWithBody(EXCEPTION_NO_REASON))).toBeNull();
  });

  test('con un motivo no vacío devuelve el issue info con su motivo', () => {
    expect(passageException(frWithBody(WITH_EXCEPTION))).toEqual({
      kind: 'passage_exception',
      severity: 'info',
      nodeId: 'FR-001',
      reason: EXCEPTION_REASON,
      message: `FR-001 declares a passage exception (R3): "${EXCEPTION_REASON}"`,
    });
  });

  test('el motivo puede venir en una línea de lista', () => {
    const body = `${FR_COMPLETE_BODY}\n## Excepción de pasaje\n\n- ${EXCEPTION_REASON}\n`;
    expect(passageException(frWithBody(body))?.reason).toBe(EXCEPTION_REASON);
  });

  test('un PRD con la sección no declara una excepción: es una regla sólo de FR', () => {
    const prdDoc = doc('id: PRD-002\ntype: PRD\ntitle: Product\njustified_by: [BC-001]\nstatus: approved', `${PRD_COMPLETE_BODY}\n## Excepción de pasaje\n\n${EXCEPTION_REASON}\n`);
    expect(passageException(prdDoc)).toBeNull();
  });

  test('sin la sección, el FR con sólo BC no publica', () => {
    const issues = frIssues([frWithBody(FR_COMPLETE_BODY), bcApproved()]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error' });
    expect(issues[0]?.message).toMatch(/not by a PRD/);
  });

  test('con la excepción declarada el FR con sólo BC publica, también en edición', () => {
    expect(frIssues([frWithBody(WITH_EXCEPTION), bcApproved()])).toEqual([]);
    expect(frIssues([frWithBody(WITH_EXCEPTION), bcApproved()], noGrandfathering)).toEqual([]);
  });

  test('una sección sin motivo no exime: el FR con sólo BC sigue sin publicar', () => {
    const issues = frIssues([frWithBody(EXCEPTION_NO_REASON), bcApproved()]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/not by a PRD/);
  });

  test('la excepción no reemplaza el BC: sin BC el FR sigue fallando y el mensaje nombra el BC', () => {
    const issues = frIssues([frWithBody(WITH_EXCEPTION, '')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('BC');
    expect(issues[0]?.message).not.toContain('PRD');
  });

  test('la excepción no tapa un BC no aprobado', () => {
    const draftBc = doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: draft', BC_ALL_SECTIONS);
    const issues = frIssues([frWithBody(WITH_EXCEPTION), draftBc]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('BC-001');
  });

  test('un PRD linkeado sigue exigiendo estar aprobado aunque la excepción esté declarada', () => {
    const issues = frIssues([frWithBody(WITH_EXCEPTION, 'justified_by: [BC-001, PRD-002]'), bcApproved(), prdApproved('PRD-002', 'proposed')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('PRD-002');
  });

  test('passageExceptions/countPassageExceptions cuentan sólo los FR con excepción declarada', () => {
    const docs = [frWithBody(WITH_EXCEPTION), prdApproved(), bcApproved()];
    expect(passageExceptions(docs)).toHaveLength(1);
    expect(countPassageExceptions(docs)).toBe(1);
    expect(passageExceptions([prdApproved(), bcApproved(), frWithBody(FR_COMPLETE_BODY)])).toEqual([]);
    expect(countPassageExceptions([frWithBody(EXCEPTION_NO_REASON)])).toBe(0);
  });
});

describe('checkLifecycle — huecos de diseño (WO-808 / SDD-125 D3)', () => {
  const approvedFr = (extra = 'justified_by: [BC-001, PRD-002]\nstatus: approved', body = FR_COMPLETE_BODY): ParsedDoc =>
    doc(`id: FR-001\ntype: FR\ntitle: Request\n${extra}`, body);
  const designOf = (featureId: string, status = 'active'): ParsedDoc =>
    doc(`id: SDD-001\ntype: SDD\ntitle: Design\nstatus: ${status}\narchitects: [${featureId}]\nimpacts_paths: ["src/**"]`, '## Tareas\n- [ ] a');
  const blueprintsHole = (issues: ReturnType<typeof checkLifecycle>, id: string) => issues.filter((i) => i.nodeId === id && i.kind === 'feature_without_blueprint');
  const docsFor = (...extra: ParsedDoc[]) => [approvedFr(), bcApproved(), prdApproved(), ...extra];

  test('un FR aprobado sin diseño produce feature_without_blueprint (warning) en edición y al publicar', () => {
    const issues = blueprintsHole(checkLifecycle(docsFor(), noGrandfathering), 'FR-001');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warning');
    expect(issues[0]?.message).toMatch(/no blueprint architecting it/);
    expect(issues[0]?.message).toContain('"architects"');
    expect(blueprintsHole(checkLifecycle(docsFor(), { ...noGrandfathering, mode: 'publish' }), 'FR-001')).toHaveLength(1);
  });

  test('un FR con un diseño que lo arquitecta no produce el hueco', () => {
    const issues = checkLifecycle(docsFor(designOf('FR-001')), noGrandfathering);
    expect(blueprintsHole(issues, 'FR-001')).toEqual([]);
    expect(issues.filter((i) => i.nodeId === 'SDD-001')).toEqual([]);
  });

  test('un FR todavía no aprobado no produce el hueco (no se exige diseño antes de aprobar)', () => {
    const proposed = approvedFr('justified_by: [BC-001, PRD-002]\nstatus: proposed');
    expect(blueprintsHole(checkLifecycle([proposed, bcApproved(), prdApproved()], noGrandfathering), 'FR-001')).toEqual([]);
  });

  test('un PRD aprobado sin diseño también produce el hueco', () => {
    const issues = checkLifecycle(docsFor(), noGrandfathering).filter((i) => i.nodeId === 'PRD-002' && i.kind === 'feature_without_blueprint');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warning');
  });

  test('un blueprint sin architects es blueprint_without_feature (error), con su propio kind de drift', () => {
    const base = doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/**"]', '## Tareas\n- [ ] a');
    const noArchitects: ParsedDoc = { ...base, frontmatter: { ...base.frontmatter, architects: [] } } as ParsedDoc;
    const issues = checkLifecycle([approvedPrd(), noArchitects], noGrandfathering).filter((i) => i.nodeId === 'SDD-001');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'blueprint_without_feature', severity: 'error' });
    expect(issues[0]?.message).toContain('non-empty "architects"');
  });

  test('un blueprint con architects sigue siendo lifecycle_violation cuando falla otra regla', () => {
    const issues = checkLifecycle([approvedPrd(), sdd('', '## Tareas\n- [ ] a')], noGrandfathering).filter((i) => i.nodeId === 'SDD-001');
    expect(issues.map((i) => i.kind)).toEqual(['lifecycle_violation']);
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

  test('el mensaje del BC no cambió al consumir la tabla única (WO-801)', () => {
    const body = '## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n';
    const issues = checkLifecycle([bc('justified_by: [FB-999]', body)], noGrandfathering);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'lifecycle_violation',
      severity: 'error',
      nodeId: 'BC-001',
      message: 'BC-001 is missing required section(s): ## Costo estimado',
    });
  });

  test('missing several sections lists all of them', () => {
    const issues = checkLifecycle([bc('justified_by: [FB-999]', '## Problema\n')], noGrandfathering);
    expect(issues[0]?.message).toContain('Impacto esperado');
    expect(issues[0]?.message).toContain('Métrica de éxito');
    expect(issues[0]?.message).toContain('Costo estimado');
  });

  test('the gate names every section of the shared domain list when the body is empty (WO-556: one list, two readers)', () => {
    const issues = checkLifecycle([bc('justified_by: [FB-999]', '')], noGrandfathering);
    for (const heading of BC_REQUIRED_SECTIONS) expect(issues[0]?.message).toContain(heading);
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

  // The parser's schema already rejects `architects: []`, so the only way to reach the rule is a ParsedDoc
  // built elsewhere (an engine). Override the frontmatter instead of re-parsing.
  const noArchitects = (extra = 'impacts_paths: ["src/**"]', body = '## Tareas\n- [ ] a'): ParsedDoc => {
    const base = sdd(extra, body);
    return { ...base, frontmatter: { ...base.frontmatter, architects: [] } } as ParsedDoc;
  };
  const messagesOf = (docs: ParsedDoc[]): string[] =>
    checkLifecycle([approvedPrd(), ...docs], noGrandfathering)
      .filter((i) => i.nodeId === 'SDD-001')
      .map((i) => i.message);

  test('architects vacío tiene su propio mensaje, separado de impacts_paths y Tareas (WO-803)', () => {
    const issues = checkLifecycle([approvedPrd(), noArchitects()], noGrandfathering).filter((i) => i.nodeId === 'SDD-001');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.message).toContain('non-empty "architects"');
    expect(issues[0]?.message).not.toContain('impacts_paths');
    expect(issues[0]?.message).not.toContain('Tareas');
  });

  test('impacts_paths vacío tiene su propio mensaje, separado de architects y Tareas (WO-803)', () => {
    const issues = checkLifecycle([approvedPrd(), sdd('', '## Tareas\n- [ ] a')], noGrandfathering).filter((i) => i.nodeId === 'SDD-001');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.message).toContain('non-empty "impacts_paths"');
    expect(issues[0]?.message).not.toContain('architects');
    expect(issues[0]?.message).not.toContain('Tareas');
  });

  test('la falta de checklist ## Tareas tiene su propio mensaje (WO-803)', () => {
    const issues = checkLifecycle([approvedPrd(), sdd('impacts_paths: ["src/**"]', 'no checklist')], noGrandfathering).filter((i) => i.nodeId === 'SDD-001');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.message).toContain('"## Tareas"');
    expect(issues[0]?.message).not.toContain('impacts_paths');
    expect(issues[0]?.message).not.toContain('architects');
  });

  test('sin architects, sin impacts_paths y sin checklist emite tres mensajes distintos (WO-803)', () => {
    const issues = checkLifecycle([approvedPrd(), noArchitects('', 'nada')], noGrandfathering).filter((i) => i.nodeId === 'SDD-001');
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    const messages = issues.map((i) => i.message);
    expect(new Set(messages).size).toBe(3);
    expect(messages.some((m) => m.includes('non-empty "architects"'))).toBe(true);
    expect(messages.some((m) => m.includes('non-empty "impacts_paths"'))).toBe(true);
    expect(messages.some((m) => m.includes('"## Tareas"'))).toBe(true);
  });

  test('ya no existe el mensaje combinado "needs both" (WO-803)', () => {
    const all = [...messagesOf([sdd('', 'nada')]), ...messagesOf([noArchitects('', 'nada')]), ...messagesOf([sdd('', '## Tareas\n- [ ] a')])];
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expect(m).not.toContain('needs both');
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

  test('WO-449: an FR with no BC, but grandfathered with its current hash (mirrors FR-001 in the real project), emits zero issues', () => {
    const legacyFr = fr('justified_by: [ART-001]');
    const ctx: LifecycleContext = { grandfathered: [{ id: 'FR-001', hash: legacyFr.node.contentHash }] };
    expect(checkLifecycle([legacyFr], ctx)).toEqual([]);
  });

  test('WO-449: once the grandfathered FR\'s content changes, the exemption lapses and the BC gate applies again', () => {
    const legacyFr = fr('justified_by: [ART-001]');
    const ctx: LifecycleContext = { grandfathered: [{ id: 'FR-001', hash: 'stale-hash' }] };
    const issues = checkLifecycle([legacyFr], ctx);
    expect(issues[0]?.message).toMatch(/grandfathering lapsed/i);
    expect(issues[1]).toMatchObject({ kind: 'lifecycle_violation', severity: 'error', nodeId: 'FR-001' });
    expect(issues[1]?.message).toContain('BC');
  });
});

describe('checkLifecycle: secciones obligatorias de PRD y FR (WO-802)', () => {
  const PRD_ALL = '## Problema\n\n## Alcance\n\n## Personas y trabajos\n\n## Métrica de éxito\n\n## Features derivadas\n';
  const FR_ALL = '## Alcance\n\nx\n\n## Criterio de aceptación\n\n- [ ] algo\n';
  const prdWith = (body: string): ParsedDoc => doc('id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]\njustified_by: [BC-001]\nstatus: approved', body);
  const frWith = (body: string): ParsedDoc => doc('id: FR-001\ntype: FR\ntitle: Request\njustified_by: [BC-001, PRD-002]', body);
  // SDD-125 R3 (WO-806): an FR also declares its PRD, so these section-only tests carry one to stay isolated.
  const prdOk = (): ParsedDoc => prdApproved();
  const only = (issues: ReturnType<typeof checkLifecycle>, id: string) => kinds(issues).filter(([, , nodeId]) => nodeId === id);

  // WO-808: an approved PRD also needs a blueprint architecting it, so these section-only tests carry one.
  const prdDesign = (): ParsedDoc => sdd('impacts_paths: ["src/**"]', '## Tareas\n- [ ] a');

  test('PRD con las cinco secciones y un BC aprobado no gana issues (WO-802)', () => {
    expect(only(checkLifecycle([prdWith(PRD_ALL), bcApproved(), prdDesign()], noGrandfathering), 'PRD-001')).toEqual([]);
  });

  test('PRD sin una sección: warning por defecto y error al publicar (WO-802)', () => {
    const body = PRD_ALL.replace('## Alcance\n\n', '');
    const edit = checkLifecycle([prdWith(body), bcApproved(), prdDesign()], noGrandfathering).filter((i) => i.nodeId === 'PRD-001');
    expect(edit).toEqual([{ kind: 'lifecycle_violation', severity: 'warning', nodeId: 'PRD-001', message: 'PRD-001 is missing required section(s): ## Alcance' }]);
    const publish = checkLifecycle([prdWith(body), bcApproved(), prdDesign()], { ...noGrandfathering, mode: 'publish' }).filter((i) => i.nodeId === 'PRD-001');
    expect(publish).toEqual([{ ...edit[0], severity: 'error' }]);
  });

  test('FR sin Criterio de aceptación: warning por defecto y error al publicar (WO-802)', () => {
    const body = '## Alcance\n\nx\n';
    const message = 'FR-001 is missing required section(s): ## Criterio de aceptación';
    expect(checkLifecycle([frWith(body), bcApproved(), prdOk()], noGrandfathering).filter((i) => i.nodeId === 'FR-001')).toEqual([
      { kind: 'lifecycle_violation', severity: 'warning', nodeId: 'FR-001', message },
    ]);
    expect(checkLifecycle([frWith(body), bcApproved(), prdOk()], { ...noGrandfathering, mode: 'publish' }).filter((i) => i.nodeId === 'FR-001')).toEqual([
      { kind: 'lifecycle_violation', severity: 'error', nodeId: 'FR-001', message },
    ]);
  });

  test('FR con Criterio de aceptación sin ítems verificables es una advertencia que nombra la sección (WO-802)', () => {
    const issues = checkLifecycle([frWith('## Alcance\n\nx\n\n## Criterio de aceptación\n\nsólo prosa\n'), bcApproved(), prdOk()], noGrandfathering).filter((i) => i.nodeId === 'FR-001');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warning', message: 'FR-001 needs at least one verifiable item (a "- [ ]" or "- [x]" line) under "## Criterio de aceptación"' });
  });

  test('FR con un ítem - [x] satisface el criterio de aceptación (WO-802)', () => {
    const body = '## Alcance\n\nx\n\n## Criterio de aceptación\n\n- [x] hecho\n';
    expect(only(checkLifecycle([frWith(body), bcApproved(), prdOk()], { ...noGrandfathering, mode: 'publish' }), 'FR-001')).toEqual([]);
  });
});
