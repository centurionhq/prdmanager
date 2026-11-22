import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { attributeIssue, computeAndon, type AttributedIssueLike } from '../../src/sync/issue-attribution.js';
import { checkLifecycle } from '../../src/lifecycle/check.js';
import { deriveLineBoard, type LineBoard } from '../../src/lifecycle/station.js';
import type { DriftIssue } from '../../src/sync/monitor.js';

const prd = (extra = ''): ParsedDoc => doc(`id: PRD-001\ntype: PRD\ntitle: Product\n${extra}`);
const sdd = (extra = ''): ParsedDoc => doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\n${extra}`);
const wo = (extra = ''): ParsedDoc => doc(`id: WO-001\ntype: WO\ntitle: Task\nimplements: [SDD-001]\n${extra}`);
const fb = (extra = ''): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\n${extra}`);
const art = (extra = ''): ParsedDoc => doc(`id: ART-001\ntype: ART\ntitle: Note\n${extra}`);

function issue(kind: DriftIssue['kind'], nodeId: string, severity: DriftIssue['severity'] = 'error'): DriftIssue {
  return { kind, severity, nodeId, message: `${nodeId} ${kind}` };
}

describe('attributeIssue', () => {
  test('broken_link on a Feedback attributes to entrada and its informed features', () => {
    const docs = [prd(), fb('informs: [PRD-001]')];
    expect(attributeIssue(issue('broken_link', 'FB-001'), docs)).toEqual({ featureIds: ['PRD-001'], blueprintId: null, station: 'entrada' });
  });

  test('invalid_link_target on an Artifact attributes to entrada and its provides_context_for features', () => {
    const docs = [prd(), art('provides_context_for: [PRD-001]')];
    expect(attributeIssue(issue('invalid_link_target', 'ART-001'), docs)).toEqual({ featureIds: ['PRD-001'], blueprintId: null, station: 'entrada' });
  });

  test('feature_changed attributes to producto, featureIds = [that feature]', () => {
    expect(attributeIssue(issue('feature_changed', 'PRD-001'), [prd()])).toEqual({ featureIds: ['PRD-001'], blueprintId: null, station: 'producto' });
  });

  test('lifecycle_violation on a feature attributes to producto', () => {
    expect(attributeIssue(issue('lifecycle_violation', 'PRD-001'), [prd()])).toEqual({ featureIds: ['PRD-001'], blueprintId: null, station: 'producto' });
  });

  test('lifecycle_violation on a non-feature (e.g. Feedback) attributes to nothing', () => {
    expect(attributeIssue(issue('lifecycle_violation', 'FB-001'), [fb()])).toEqual({ featureIds: [], blueprintId: null, station: null });
  });

  test('blueprint_changed attributes to diseno_tecnico with the blueprint id and its architected features', () => {
    const docs = [prd(), sdd()];
    expect(attributeIssue(issue('blueprint_changed', 'SDD-001'), docs)).toEqual({ featureIds: ['PRD-001'], blueprintId: 'SDD-001', station: 'diseno_tecnico' });
  });

  test('impacts_warning attributes to diseno_tecnico', () => {
    const docs = [prd(), sdd()];
    expect(attributeIssue(issue('impacts_warning', 'SDD-001', 'warning'), docs)).toEqual({ featureIds: ['PRD-001'], blueprintId: 'SDD-001', station: 'diseno_tecnico' });
  });

  test('awaiting_ci_report attributes to diseno_tecnico', () => {
    const docs = [prd(), sdd()];
    expect(attributeIssue(issue('awaiting_ci_report', 'SDD-001', 'warning'), docs)).toEqual({ featureIds: ['PRD-001'], blueprintId: 'SDD-001', station: 'diseno_tecnico' });
  });

  test('code_out_of_sync (nodeId is the blueprint) attributes to construccion', () => {
    const docs = [prd(), sdd()];
    expect(attributeIssue(issue('code_out_of_sync', 'SDD-001'), docs)).toEqual({ featureIds: ['PRD-001'], blueprintId: 'SDD-001', station: 'construccion' });
  });

  test('work_order_out_of_sync resolves the blueprint(s) it implements and attributes to construccion', () => {
    const docs = [prd(), sdd(), wo()];
    expect(attributeIssue(issue('work_order_out_of_sync', 'WO-001'), docs)).toEqual({ featureIds: ['PRD-001'], blueprintId: 'SDD-001', station: 'construccion' });
  });

  test('an unrecognized issue kind attributes to nothing', () => {
    expect(attributeIssue(issue('deprecated_field', 'SDD-001', 'warning'), [sdd()])).toEqual({ featureIds: [], blueprintId: null, station: null });
  });

  test('SDD-125 (WO-808): feature_without_blueprint para en diseno_tecnico y detiene la línea', () => {
    expect(attributeIssue(issue('feature_without_blueprint', 'PRD-001', 'warning'), [prd()])).toEqual({
      featureIds: ['PRD-001'],
      blueprintId: null,
      station: 'diseno_tecnico',
      stopsLine: true,
    });
  });

  test('SDD-125 (WO-808): blueprint_without_feature atribuye al blueprint en diseno_tecnico', () => {
    const noArchitects = sdd();
    const bare: ParsedDoc = { ...noArchitects, frontmatter: { ...noArchitects.frontmatter, architects: [] }, edges: [] } as ParsedDoc;
    expect(attributeIssue(issue('blueprint_without_feature', 'SDD-001'), [bare])).toEqual({
      featureIds: [],
      blueprintId: 'SDD-001',
      station: 'diseno_tecnico',
    });
  });

  test('an issue targeting an unknown node attributes to nothing', () => {
    expect(attributeIssue(issue('broken_link', 'FB-999'), [])).toEqual({ featureIds: [], blueprintId: null, station: null });
  });
});

describe('computeAndon', () => {
  const emptyBoard = (featureIds: string[]): LineBoard => ({
    features: featureIds.map((id) => ({ id, kind: 'PRD', title: id, status: 'draft', station: 'entrada', progress: { done: 0, total: 0, stopped: 0 }, children: [] })),
    andon: null,
  });

  test('no errors produces a null andon and no andonStation on any feature', () => {
    const board = computeAndon([], emptyBoard(['PRD-001']));
    expect(board.andon).toBeNull();
    expect(board.features[0]?.andonStation).toBeUndefined();
  });

  test('warnings never contribute to the andon', () => {
    const issues: AttributedIssueLike[] = [{ severity: 'warning', featureIds: ['PRD-001'], station: 'diseno_tecnico' }];
    const board = computeAndon(issues, emptyBoard(['PRD-001']));
    expect(board.andon).toBeNull();
  });

  test('a single error sets both the feature andonStation and the project andon', () => {
    const issues: AttributedIssueLike[] = [{ severity: 'error', featureIds: ['PRD-001'], station: 'construccion' }];
    const board = computeAndon(issues, emptyBoard(['PRD-001']));
    expect(board.features[0]?.andonStation).toBe('construccion');
    expect(board.andon).toEqual({ featureId: 'PRD-001', station: 'construccion' });
  });

  test('producto beats construccion for the same feature (earlier station wins)', () => {
    const issues: AttributedIssueLike[] = [
      { severity: 'error', featureIds: ['PRD-001'], station: 'construccion' },
      { severity: 'error', featureIds: ['PRD-001'], station: 'producto' },
    ];
    const board = computeAndon(issues, emptyBoard(['PRD-001']));
    expect(board.features[0]?.andonStation).toBe('producto');
    expect(board.andon).toEqual({ featureId: 'PRD-001', station: 'producto' });
  });

  test('project andon is the earliest across every feature', () => {
    const issues: AttributedIssueLike[] = [
      { severity: 'error', featureIds: ['PRD-001'], station: 'construccion' },
      { severity: 'error', featureIds: ['PRD-002'], station: 'entrada' },
    ];
    const board = computeAndon(issues, emptyBoard(['PRD-001', 'PRD-002']));
    expect(board.andon).toEqual({ featureId: 'PRD-002', station: 'entrada' });
  });

  test('an issue with no attributed station is ignored', () => {
    const issues: AttributedIssueLike[] = [{ severity: 'error', featureIds: ['PRD-001'], station: null }];
    const board = computeAndon(issues, emptyBoard(['PRD-001']));
    expect(board.andon).toBeNull();
  });

  test('SDD-125 (WO-808): un FR aprobado sin diseño detiene la línea en diseno_tecnico (warning con stopsLine)', () => {
    // End to end over the real pieces: the lifecycle hole, its attribution and the board derived from the docs.
    const body = '## Alcance\n\nx\n\n## Criterio de aceptación\n\n- [ ] algo\n';
    const docs = [
      doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: approved', '## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n'),
      doc('id: PRD-002\ntype: PRD\ntitle: Product\nimplements: [MRD-001]\njustified_by: [BC-001]\nstatus: approved', '## Problema\n\n## Alcance\n\n## Personas y trabajos\n\n## Métrica de éxito\n\n## Features derivadas\n'),
      doc('id: FR-001\ntype: FR\ntitle: Request\njustified_by: [BC-001, PRD-002]\nstatus: approved', body),
    ];
    const hole = checkLifecycle(docs, { grandfathered: [] }).filter((i) => i.kind === 'feature_without_blueprint');
    expect(hole.map((i) => i.nodeId)).toEqual(['PRD-002', 'FR-001']);
    const attributed = hole.map((i) => ({ severity: i.severity, ...attributeIssue(i, docs) }));
    const board = computeAndon(attributed, deriveLineBoard(docs));
    // Both features are justified by BC-001, so they nest under its row (WO-443 collapsing), not top-level.
    const bcRow = board.features.find((f) => f.id === 'BC-001');
    const fr = bcRow?.children.find((f) => f.id === 'FR-001');
    expect(fr?.andonStation).toBe('diseno_tecnico');
    expect(board.andon).toEqual({ featureId: 'PRD-002', station: 'diseno_tecnico' });
  });

  test('un warning sin stopsLine no detiene la línea (la regla nueva no afloja el andon)', () => {
    const issues: AttributedIssueLike[] = [{ severity: 'warning', featureIds: ['PRD-001'], station: 'diseno_tecnico', stopsLine: false }];
    expect(computeAndon(issues, emptyBoard(['PRD-001'])).andon).toBeNull();
  });

  test('WO-444: an error on a nested PRD (WO-443 row collapsing) sets andonStation on the child row, not just the project-wide andon', () => {
    const board: LineBoard = {
      features: [
        {
          id: 'BC-001',
          kind: 'BC',
          title: 'Business case',
          status: 'approved',
          station: 'producto',
          progress: { done: 0, total: 0, stopped: 0 },
          children: [{ id: 'PRD-001', kind: 'PRD', title: 'Product', status: 'draft', station: 'producto', progress: { done: 0, total: 0, stopped: 0 }, children: [] }],
        },
      ],
      andon: null,
    };
    const issues: AttributedIssueLike[] = [{ severity: 'error', featureIds: ['PRD-001'], station: 'producto' }];
    const result = computeAndon(issues, board);
    expect(result.features[0]?.andonStation).toBeUndefined();
    expect(result.features[0]?.children[0]?.andonStation).toBe('producto');
    expect(result.andon).toEqual({ featureId: 'PRD-001', station: 'producto' });
  });
});
