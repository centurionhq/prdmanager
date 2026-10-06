import { describe, expect, test } from 'vitest';
import type { DriftIssueDto } from '@prdm/contracts';
import {
  KIND_COPY,
  REASON_LABELS,
  issueCopy,
  reasonFromMessage,
} from '../../src/routes/drift/drift-issue-copy.js';

let seq = 0;

function issue(overrides: Partial<DriftIssueDto> = {}): DriftIssueDto {
  seq += 1;
  return {
    kind: 'code_out_of_sync',
    severity: 'error',
    nodeId: 'SDD-008',
    target: 'src/x/y.ts',
    message: 'src/x/y.ts is out of sync with SDD-008 (code_changed)',
    id: seq.toString(16).padStart(4, '0'),
    featureIds: ['FR-002'],
    blueprintId: 'SDD-008',
    station: 'construccion',
    detectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Non-optional record accessor so a test reads like the invariant it asserts. */
function reasonLabel(reason: string): string {
  const label = REASON_LABELS[reason];
  if (label === undefined) throw new Error(`expected a REASON_LABELS entry for "${reason}"`);
  return label;
}

function joined(copy: { readonly tokens: readonly { readonly text: string }[] }): string {
  return copy.tokens.map((token) => token.text).join('');
}

function monoTexts(copy: { readonly tokens: readonly { readonly text: string; readonly mono: boolean }[] }): string[] {
  return copy.tokens.filter((token) => token.mono).map((token) => token.text);
}

/**
 * The 11 `IssueKind`s, each with the exact real-format message the engine builds
 * (`packages/core/src/sync/monitor.ts:195-267`, `packages/core/src/engine.ts:347`,
 * `packages/server/src/engine/pg-project-engine.ts:999`) and a distinctive Spanish fragment its copy must
 * carry. Shared by the per-kind test and the guardian test.
 */
interface KindCase {
  readonly kind: string;
  readonly issue: DriftIssueDto;
  readonly spanish: string;
}

const KIND_CASES: readonly KindCase[] = [
  {
    kind: 'code_out_of_sync',
    issue: issue({
      kind: 'code_out_of_sync',
      nodeId: 'SDD-008',
      target: 'pkg/a.ts',
      blueprintId: 'SDD-008',
      message: 'pkg/a.ts is out of sync with SDD-008 (code_changed)',
    }),
    spanish: 'no coincide con SDD-008',
  },
  {
    kind: 'blueprint_changed',
    issue: issue({
      kind: 'blueprint_changed',
      nodeId: 'SDD-008',
      target: undefined,
      blueprintId: 'SDD-008',
      message: 'SDD-008 changed since its last acknowledged version',
    }),
    spanish: 'cambió desde la última vez que se reconoció',
  },
  {
    kind: 'feature_changed',
    issue: issue({
      kind: 'feature_changed',
      nodeId: 'PRD-007',
      target: undefined,
      blueprintId: null,
      message: 'PRD-007 changed since its last acknowledged version; review its blueprints',
    }),
    spanish: 'cambió desde su última versión reconocida',
  },
  {
    kind: 'work_order_out_of_sync',
    issue: issue({
      kind: 'work_order_out_of_sync',
      nodeId: 'WO-625',
      target: undefined,
      blueprintId: null,
      message: 'WO-625 was completed against an older version of its blueprint',
    }),
    spanish: 'se completó contra una versión anterior de su blueprint',
  },
  {
    kind: 'impacts_warning',
    issue: issue({
      kind: 'impacts_warning',
      severity: 'warning',
      nodeId: 'SDD-008',
      target: undefined,
      blueprintId: 'SDD-008',
      message: 'impacts_paths pattern "lib/**" matched no file on disk',
    }),
    spanish: 'no resuelve a nada en disco',
  },
  {
    kind: 'awaiting_ci_report',
    issue: issue({
      kind: 'awaiting_ci_report',
      severity: 'warning',
      nodeId: 'SDD-008',
      target: undefined,
      blueprintId: 'SDD-008',
      message:
        "SDD-008's impacts_paths changed since the last CI-verified code report (or none exists yet); its code governance baseline is left untouched until a new report arrives",
    }),
    spanish: 'espera un reporte de CI',
  },
  {
    kind: 'broken_link',
    issue: issue({
      kind: 'broken_link',
      nodeId: 'WO-001',
      target: 'NOPE-1',
      blueprintId: null,
      message: 'WO-001 links to missing NOPE-1 (IMPLEMENTS)',
    }),
    spanish: 'enlaza a NOPE-1, que ya no existe',
  },
  {
    kind: 'invalid_link_target',
    issue: issue({
      kind: 'invalid_link_target',
      nodeId: 'WO-001',
      target: 'PRD-007',
      blueprintId: null,
      message: 'IMPLEMENTS from WO-001 must target a Blueprint, got Feature',
    }),
    spanish: 'apunta al tipo de documento equivocado',
  },
  {
    kind: 'deprecated_field',
    issue: issue({
      kind: 'deprecated_field',
      severity: 'warning',
      nodeId: 'WO-001',
      target: undefined,
      blueprintId: null,
      message: 'WO-001 uses deprecated field "status"; use "state" instead (run `prdm migrate docs`)',
    }),
    spanish: 'usa un campo deprecado',
  },
  {
    kind: 'lifecycle_violation',
    issue: issue({
      kind: 'lifecycle_violation',
      severity: 'warning',
      nodeId: 'FB-002',
      target: undefined,
      blueprintId: null,
      message: 'FB-002 must link to a feature via "informs" (or be marked "root: true")',
    }),
    spanish: 'no cumple una regla de ciclo de vida',
  },
  {
    kind: 'status_write_failed',
    issue: issue({
      kind: 'status_write_failed',
      nodeId: 'WO-001',
      target: undefined,
      blueprintId: null,
      message: 'could not set WO-001 to done: boom',
    }),
    spanish: 'No se pudo escribir el estado',
  },
];

describe('issueCopy por kind', () => {
  test('cubre los 11 IssueKind con copy en español y una acción sugerida', () => {
    expect(KIND_CASES).toHaveLength(11);
    for (const { kind, issue: sample, spanish } of KIND_CASES) {
      expect(KIND_COPY[kind], `KIND_COPY must know "${kind}"`).toBeDefined();
      const copy = issueCopy(sample);
      expect(copy.headline, kind).toContain(spanish);
      expect(copy.headline, kind).not.toBe(sample.message);
      expect(copy.action, kind).not.toBeNull();
      expect(copy.action, kind).not.toBe('');
    }
  });

  test('los tokens reconstruyen el headline exacto', () => {
    for (const { issue: sample } of KIND_CASES) {
      const copy = issueCopy(sample);
      expect(joined(copy)).toBe(copy.headline);
    }
  });
});

describe('code_out_of_sync: razón extraída y traducida', () => {
  test('extrae code_changed del mensaje real y lo traduce, con path e id en mono', () => {
    const copy = issueCopy(
      issue({
        message: 'pkg/a.ts is out of sync with SDD-008 (code_changed)',
        target: 'pkg/a.ts',
        blueprintId: 'SDD-008',
      }),
    );
    expect(copy.headline).toContain(reasonLabel('code_changed'));
    expect(copy.headline).not.toContain('code_changed');
    expect(monoTexts(copy)).toContain('pkg/a.ts');
    expect(monoTexts(copy)).toContain('SDD-008');
  });

  test('extrae missing del mensaje real y lo traduce', () => {
    const copy = issueCopy(
      issue({
        message: 'pkg/a.ts is out of sync with SDD-008 (missing)',
        target: 'pkg/a.ts',
        blueprintId: 'SDD-008',
      }),
    );
    expect(copy.headline).toContain(reasonLabel('missing'));
    expect(copy.headline).not.toContain('(missing)');
  });

  test('la razón detectada entra al glosario con su explicación', () => {
    const copy = issueCopy(issue({ message: 'pkg/a.ts is out of sync with SDD-008 (missing)' }));
    const terms = copy.glossary.map((term) => term.term);
    expect(terms).toContain('SDD-008');
    expect(terms).toContain('missing');
    const reasonTerm = copy.glossary.find((term) => term.term === 'missing');
    expect(reasonTerm?.tip).toContain(reasonLabel('missing'));
  });

  test('sin target no nombra un archivo y conserva el mensaje crudo', () => {
    const raw = 'pkg/a.ts is out of sync with SDD-008 (missing)';
    const copy = issueCopy(issue({ message: raw, target: undefined, blueprintId: 'SDD-008' }));
    expect(copy.headline).not.toContain('undefined');
    expect(copy.headline).toContain(raw);
    expect(copy.headline).toContain('SDD-008');
    expect(copy.action).not.toBeNull();
  });
});

describe('reasonFromMessage', () => {
  test('acepta sólo el enum conocido al final del mensaje', () => {
    expect(reasonFromMessage('pkg/a.ts is out of sync with SDD-008 (code_changed)')).toBe('code_changed');
    expect(reasonFromMessage('pkg/a.ts is out of sync with SDD-008 (missing)')).toBe('missing');
  });

  test('una razón fuera del enum o ausente devuelve null', () => {
    expect(reasonFromMessage('pkg/a.ts is out of sync with SDD-008 (raro_nuevo)')).toBeNull();
    expect(reasonFromMessage('pkg/a.ts is out of sync with SDD-008 (unchanged)')).toBeNull();
    expect(reasonFromMessage('pkg/a.ts is out of sync with SDD-008')).toBeNull();
    expect(reasonFromMessage('(code_changed) but not at the end')).toBeNull();
    expect(reasonFromMessage('no parentheses at all')).toBeNull();
  });

  test('tolera espacios finales', () => {
    expect(reasonFromMessage('pkg/a.ts is out of sync with SDD-008 (code_changed)\n')).toBe('code_changed');
  });
});

describe('degradación sin romper', () => {
  test('razón desconocida: sin cláusula y sin imprimir el token crudo', () => {
    const copy = issueCopy(
      issue({ message: 'pkg/a.ts is out of sync with SDD-008 (raro_nuevo)', target: 'pkg/a.ts' }),
    );
    expect(copy.headline).toBe('El archivo pkg/a.ts no coincide con SDD-008');
    expect(copy.headline).not.toContain('raro_nuevo');
    expect(copy.headline).not.toContain('code_changed');
    expect(copy.action).not.toBeNull();
  });

  test('razón ausente: sin cláusula', () => {
    const copy = issueCopy(issue({ message: 'pkg/a.ts is out of sync with SDD-008', target: 'pkg/a.ts' }));
    expect(copy.headline).toBe('El archivo pkg/a.ts no coincide con SDD-008');
  });

  test('un formato de mensaje nuevo degrada sin lanzar', () => {
    expect(() => issueCopy(issue({ message: 'totally different engine wording' }))).not.toThrow();
    const copy = issueCopy(issue({ message: 'totally different engine wording' }));
    expect(copy.headline).toContain('SDD-008');
  });

  test('kind desconocido: mensaje crudo, sin acción', () => {
    const raw = 'brand new engine kind happened';
    const copy = issueCopy(issue({ kind: 'engine_v2_novel', message: raw, blueprintId: 'SDD-008' }));
    expect(copy.headline).toBe(raw);
    expect(copy.action).toBeNull();
    expect(joined(copy)).toBe(raw);
  });

  test('kind desconocido no afirma una razón que no puede interpretar', () => {
    const copy = issueCopy(
      issue({ kind: 'engine_v2_novel', message: 'something new happened (code_changed)', blueprintId: 'SDD-008' }),
    );
    expect(copy.headline).toBe('something new happened (code_changed)');
    expect(copy.glossary.map((term) => term.term)).toEqual(['SDD-008']);
  });
});

describe('guardián: nada del texto crudo del motor en el copy humanizado', () => {
  const FORBIDDEN = [
    'is out of sync with',
    'links to missing',
    'must target a',
    'changed since its last acknowledged version',
    'uses deprecated field',
    'was completed against an older version of its blueprint',
  ] as const;

  test('los 11 kinds no filtran fragmentos en inglés del motor', () => {
    for (const { kind, issue: sample } of KIND_CASES) {
      const copy = issueCopy(sample);
      const haystack = [
        copy.headline,
        copy.action ?? '',
        ...copy.glossary.map((term) => `${term.term} ${term.tip}`),
      ].join('\n');
      for (const fragment of FORBIDDEN) {
        expect(haystack, `kind "${kind}" leaked "${fragment}"`).not.toContain(fragment);
      }
    }
  });
});
