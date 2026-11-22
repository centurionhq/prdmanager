import { describe, expect, test } from 'vitest';
import type { DriftIssueDto } from '@prdm/contracts';
import {
  EMPTY_FILTERS,
  PAGE_SIZE,
  SUBGROUP_NO_BLUEPRINT_LABEL,
  acknowledgeTargetFor,
  acknowledgeableTargets,
  filterIssues,
  groupIssues,
  paginateIssues,
  splitMessage,
  subgroupLabel,
} from '../../src/routes/drift/drift-groups.js';

let seq = 0;

function issue(overrides: Partial<DriftIssueDto> = {}): DriftIssueDto {
  seq += 1;
  return {
    kind: 'code_out_of_sync',
    severity: 'error',
    nodeId: 'SDD-012',
    target: 'packages/cli/src/import.ts',
    message: 'packages/cli/src/import.ts is out of sync with SDD-012',
    id: seq.toString(16).padStart(4, '0'),
    featureIds: ['FR-002'],
    blueprintId: 'SDD-012',
    station: 'construccion',
    detectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Non-optional accessor so a test reads like the invariant it asserts (no `noUncheckedIndexedAccess` noise). */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an item at index ${index}`);
  return item;
}

/** The real-world shape of the drift screen: 226 issues, one single `kind`, four attribution buckets. */
function massIssues(): readonly DriftIssueDto[] {
  const issues: DriftIssueDto[] = [];
  for (let i = 0; i < 100; i += 1) issues.push(issue({ blueprintId: 'SDD-010', message: `SDD-010 out of sync #${i}` }));
  for (let i = 0; i < 80; i += 1) issues.push(issue({ blueprintId: 'SDD-002', message: `SDD-002 out of sync #${i}` }));
  for (let i = 0; i < 40; i += 1) issues.push(issue({ blueprintId: 'SDD-030', message: `SDD-030 out of sync #${i}` }));
  for (let i = 0; i < 6; i += 1) issues.push(issue({ blueprintId: null, message: `huerfano #${i}` }));
  return issues;
}

describe('subgroupLabel', () => {
  test('uses the blueprint id when there is one', () => {
    expect(subgroupLabel('SDD-012')).toBe('SDD-012');
  });
  test('falls back to the explicit "Sin blueprint" label', () => {
    expect(subgroupLabel(null)).toBe(SUBGROUP_NO_BLUEPRINT_LABEL);
  });
});

describe('groupIssues', () => {
  test('226 issues of a single kind become one group with one subgroup per blueprint and exact counts', () => {
    const groups = groupIssues(massIssues());

    expect(groups).toHaveLength(1);
    const group = at(groups, 0);
    expect(group.kind).toBe('code_out_of_sync');
    expect(group.label).toBe('Código fuera de sincronía');
    expect(group.subgroups.map((subgroup) => [subgroup.blueprintId, subgroup.issues.length])).toEqual([
      ['SDD-002', 80],
      ['SDD-010', 100],
      ['SDD-030', 40],
      [null, 6],
    ]);
    // The bug this WO fixes: the whole list used to land in a single group with no second level.
    expect(group.subgroups.length).toBeGreaterThan(1);
  });

  test('issues without a blueprint land in an explicit "Sin blueprint" subgroup, always last', () => {
    const group = at(groupIssues(massIssues()), 0);
    const last = group.subgroups.at(-1);

    expect(last?.blueprintId).toBeNull();
    expect(last?.label).toBe(SUBGROUP_NO_BLUEPRINT_LABEL);
    expect(last?.issues).toHaveLength(6);
    expect(last?.issues.every((i) => i.blueprintId === null)).toBe(true);
    // No issue is lost, none is mixed into an attributed subgroup.
    const attributed = group.subgroups.filter((s) => s.blueprintId !== null);
    expect(attributed.every((s) => s.issues.every((i) => i.blueprintId !== null))).toBe(true);
    expect(group.subgroups.reduce((total, s) => total + s.issues.length, 0)).toBe(226);
  });

  test('subgroups are sorted by blueprintId ascending with the unattributed one last', () => {
    const group = at(groupIssues([
      issue({ blueprintId: 'SDD-030' }),
      issue({ blueprintId: 'SDD-002' }),
      issue({ blueprintId: null }),
      issue({ blueprintId: 'SDD-010' }),
    ]), 0);

    expect(group.subgroups.map((s) => s.blueprintId)).toEqual(['SDD-002', 'SDD-010', 'SDD-030', null]);
  });

  test('keeps GROUP_ORDER, appends unknown kinds via fallback and drops empty groups', () => {
    const groups = groupIssues([
      issue({ kind: 'broken_link', blueprintId: 'SDD-001' }),
      issue({ kind: 'code_out_of_sync', blueprintId: 'SDD-001' }),
      issue({ kind: 'totally_new_kind', blueprintId: 'SDD-001' }),
      issue({ kind: 'code_out_of_sync', blueprintId: 'SDD-002' }),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(['code_out_of_sync', 'broken_link', 'totally_new_kind']);
    expect(at(groups, 0).subgroups.map((s) => s.blueprintId)).toEqual(['SDD-001', 'SDD-002']);
    // An unknown kind still gets its own group, labelled with its raw name (no GROUP_LABELS entry).
    expect(at(groups, 2).label).toBe('totally_new_kind');
    // No group for a kind with zero issues.
    expect(groups.some((group) => group.kind === 'work_order_out_of_sync')).toBe(false);
  });

  test('landed_but_open is titled in Spanish and sits right after work_order_out_of_sync (SDD-107 D1)', () => {
    const groups = groupIssues([
      issue({ kind: 'broken_link' }),
      issue({ kind: 'landed_but_open', severity: 'warning' }),
      issue({ kind: 'work_order_out_of_sync' }),
    ]);

    // Both are work-order classes, so they stay adjacent: «Órdenes fuera de sincronía» then «Órdenes ya
    // aterrizadas». The raw engine enum must never reach the title.
    expect(groups.map((group) => group.kind)).toEqual(['work_order_out_of_sync', 'landed_but_open', 'broken_link']);
    expect(at(groups, 1).label).toBe('Órdenes ya aterrizadas');
  });

  test('an empty list yields no groups', () => {
    expect(groupIssues([])).toEqual([]);
  });
});

describe('splitMessage', () => {
  test('marks an exact literal the caller wrote as mono, even when it looks like a bare word', () => {
    // The sha the copy module writes cannot be told apart from any other 7-hex run by a pattern, so the
    // caller names it explicitly (SDD-107 D2).
    expect(splitMessage('el commit 9def4e2 la referencia', { literals: ['9def4e2'] })).toEqual([
      { text: 'el commit ', mono: false },
      { text: '9def4e2', mono: true },
      { text: ' la referencia', mono: false },
    ]);
  });

  test('a literal that is not in the message changes nothing', () => {
    expect(splitMessage('sin sha acá', { literals: ['9def4e2'] })).toEqual([{ text: 'sin sha acá', mono: false }]);
  });

  test('still marks ids and paths as mono alongside a literal', () => {
    const tokens = splitMessage('SDD-008 fijó 9def4e2 en packages/app/src/a.ts', { literals: ['9def4e2'] });
    expect(tokens.filter((token) => token.mono).map((token) => token.text)).toEqual([
      'SDD-008',
      '9def4e2',
      'packages/app/src/a.ts',
    ]);
    expect(tokens.map((token) => token.text).join('')).toBe('SDD-008 fijó 9def4e2 en packages/app/src/a.ts');
  });
});

describe('filterIssues', () => {
  const issues: readonly DriftIssueDto[] = [
    issue({
      kind: 'code_out_of_sync',
      severity: 'error',
      blueprintId: 'SDD-012',
      nodeId: 'SDD-012',
      target: 'packages/cli/src/import.ts',
      featureIds: ['FR-002'],
      message: 'packages/cli/src/import.ts is out of sync with SDD-012',
    }),
    issue({
      kind: 'broken_link',
      severity: 'warning',
      blueprintId: 'SDD-013',
      nodeId: 'FR-009',
      target: 'docs/prd/PRD-041.md',
      featureIds: ['FR-009', 'FR-011'],
      message: 'enlace roto hacia docs/prd/PRD-041.md',
    }),
    issue({
      kind: 'code_out_of_sync',
      severity: 'warning',
      blueprintId: null,
      nodeId: 'ADR-004',
      target: undefined,
      featureIds: [],
      message: 'archivo sin atribución',
    }),
  ];

  test('EMPTY_FILTERS keeps every issue', () => {
    expect(filterIssues(issues, EMPTY_FILTERS)).toHaveLength(3);
    expect(EMPTY_FILTERS).toEqual({ severity: 'all', kind: 'all', blueprintId: 'all', query: '' });
  });

  test('filters by severity alone', () => {
    expect(filterIssues(issues, { ...EMPTY_FILTERS, severity: 'error' }).map((i) => i.nodeId)).toEqual(['SDD-012']);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, severity: 'warning' }).map((i) => i.nodeId)).toEqual(['FR-009', 'ADR-004']);
  });

  test('filters by kind alone', () => {
    expect(filterIssues(issues, { ...EMPTY_FILTERS, kind: 'broken_link' })).toHaveLength(1);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, kind: 'code_out_of_sync' })).toHaveLength(2);
  });

  test('filters by blueprintId alone, exact match (null is not "all")', () => {
    expect(filterIssues(issues, { ...EMPTY_FILTERS, blueprintId: 'SDD-013' }).map((i) => i.nodeId)).toEqual(['FR-009']);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, blueprintId: 'SDD-01' })).toHaveLength(0);
  });

  test('query matches message/nodeId/target/featureIds/blueprintId case-insensitively', () => {
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: 'IMPORT.TS' })).toHaveLength(1);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: 'fr-011' }).map((i) => i.nodeId)).toEqual(['FR-009']);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: 'PRD-041.MD' })).toHaveLength(1);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: 'adr-004' }).map((i) => i.nodeId)).toEqual(['ADR-004']);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: 'sdd-012' })).toHaveLength(1);
  });

  test('a blank or whitespace-only query does not filter', () => {
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: '' })).toHaveLength(3);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: '   ' })).toHaveLength(3);
    expect(filterIssues(issues, { ...EMPTY_FILTERS, query: '  import.ts  ' })).toHaveLength(1);
  });

  test('combined facets AND together', () => {
    const filtered = filterIssues(issues, {
      severity: 'warning',
      kind: 'broken_link',
      blueprintId: 'SDD-013',
      query: 'prd-041',
    });
    expect(filtered.map((i) => i.nodeId)).toEqual(['FR-009']);

    // Flipping one facet to a value that contradicts the rest empties the list.
    expect(filterIssues(issues, { severity: 'error', kind: 'broken_link', blueprintId: 'all', query: '' })).toHaveLength(0);
  });
});

describe('paginateIssues', () => {
  test('226 rows show PAGE_SIZE rows and leave 176 hidden', () => {
    const result = paginateIssues(massIssues(), PAGE_SIZE);
    expect(result.visible).toHaveLength(50);
    expect(result.remaining).toBe(176);
  });

  test('a visible count under pageSize is clamped up to pageSize', () => {
    expect(paginateIssues(massIssues(), 0).visible).toHaveLength(PAGE_SIZE);
    expect(paginateIssues(massIssues(), 10).remaining).toBe(176);
  });

  test('revealing more shows more rows and reduces the remainder', () => {
    const result = paginateIssues(massIssues(), 150);
    expect(result.visible).toHaveLength(150);
    expect(result.remaining).toBe(76);
  });

  test('a visible count past the end does not overflow', () => {
    const result = paginateIssues(massIssues(), 1_000);
    expect(result.visible).toHaveLength(226);
    expect(result.remaining).toBe(0);
  });

  test('an empty list paginates to nothing', () => {
    expect(paginateIssues([], PAGE_SIZE)).toEqual({ visible: [], remaining: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------
// SDD-111 / WO-764 — acknowledging moves the whole DOCUMENT (`core/src/sync/monitor.ts:345-356`), so every
// target carries its own debt: the total count, how much of it the baseline move actually resolves, and how
// many documents an `all` ack advances. Counting the filtered view would under-report an irreversible action.
// ---------------------------------------------------------------------------------------------------

describe('acknowledgeTargetFor', () => {
  test('the blueprint of the issue is its document', () => {
    expect(acknowledgeTargetFor(issue({ blueprintId: 'SDD-013', nodeId: 'SDD-013' }))).toBe('SDD-013');
  });

  test('an unattributed issue falls back to its own document nodeId', () => {
    expect(acknowledgeTargetFor(issue({ blueprintId: null, nodeId: 'FR-009', kind: 'lifecycle_violation' }))).toBe('FR-009');
  });

  test('a work order row has no per-row target: the DTO does not carry its status and the server rejects non-final ones', () => {
    expect(acknowledgeTargetFor(issue({ blueprintId: null, nodeId: 'WO-625', kind: 'landed_but_open' }))).toBeNull();
    // Even attributed, the row itself is never the action: its blueprint's subgroup covers it.
    expect(acknowledgeTargetFor(issue({ blueprintId: 'SDD-012', nodeId: 'WO-625', kind: 'work_order_out_of_sync' }))).toBeNull();
  });

  test('a nodeId that is not a document id has no target either', () => {
    expect(acknowledgeTargetFor(issue({ blueprintId: null, nodeId: 'packages/app/src/a.ts' }))).toBeNull();
    expect(acknowledgeTargetFor(issue({ blueprintId: null, nodeId: 'sdd-013' }))).toBeNull();
  });
});

describe('acknowledgeableTargets', () => {
  test('counts the whole document, not the rows of one kind, and keeps "Todo el proyecto" last', () => {
    const targets = acknowledgeableTargets([
      issue({ blueprintId: 'SDD-013', kind: 'code_out_of_sync' }),
      issue({ blueprintId: 'SDD-013', kind: 'impacts_warning', severity: 'warning' }),
      issue({ blueprintId: 'SDD-013', kind: 'lifecycle_violation' }),
      issue({ blueprintId: 'SDD-002', kind: 'code_out_of_sync' }),
    ]);

    expect(targets.map((target) => [target.value, target.count, target.documents])).toEqual([
      ['SDD-013', 3, 1],
      ['SDD-002', 1, 1],
      ['all', 4, 2],
    ]);
    expect(at(targets, 0).label).toBe('SDD-013 · 3 issues');
    expect(at(targets, 2).label).toBe('Todo el proyecto · 4 issues');
  });

  test('splits the debt: only code and work orders are resolved by moving the baseline', () => {
    const targets = acknowledgeableTargets([
      issue({ blueprintId: 'SDD-013', kind: 'code_out_of_sync' }),
      issue({ blueprintId: 'SDD-013', kind: 'work_order_out_of_sync' }),
      issue({ blueprintId: 'SDD-013', kind: 'lifecycle_violation' }),
      issue({ blueprintId: 'SDD-013', kind: 'impacts_warning', severity: 'warning' }),
      issue({ blueprintId: 'SDD-013', kind: 'landed_but_open', severity: 'warning' }),
    ]);

    expect(at(targets, 0)).toMatchObject({ value: 'SDD-013', count: 5, resolvable: 2 });
    expect(at(targets, 1)).toMatchObject({ value: 'all', count: 5, resolvable: 2 });
  });

  test('singular in the label for a single issue', () => {
    const targets = acknowledgeableTargets([issue({ blueprintId: 'ADR-008' })]);
    expect(at(targets, 0).label).toBe('ADR-008 · 1 issue');
    expect(at(targets, 1).label).toBe('Todo el proyecto · 1 issue');
  });

  test('a document reachable only through its nodeId is a target too', () => {
    const targets = acknowledgeableTargets([issue({ blueprintId: null, nodeId: 'FR-009', kind: 'lifecycle_violation' })]);
    expect(targets.map((target) => [target.value, target.count])).toEqual([
      ['FR-009', 1],
      ['all', 1],
    ]);
  });

  test('rows with no target contribute only to "Todo el proyecto"', () => {
    const targets = acknowledgeableTargets([issue({ blueprintId: null, nodeId: 'WO-625', kind: 'landed_but_open' })]);
    expect(targets.map((target) => target.value)).toEqual(['all']);
    expect(at(targets, 0).documents).toBe(0);
  });

  test('an empty report still offers "Todo el proyecto" at zero', () => {
    expect(acknowledgeableTargets([])).toEqual([
      { value: 'all', label: 'Todo el proyecto · 0 issues', count: 0, resolvable: 0, documents: 0 },
    ]);
  });
});
