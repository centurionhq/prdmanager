/**
 * Lifecycle DTO validation (SDD-012 "Centurion Factory conectado al backend SaaS", WO-325): the
 * `Station` enum plus the line-board and project-overview shapes the factory frontend renders.
 */
import { describe, expect, test } from 'vitest';
import { featureLineSchema, lineBoardSchema, projectOverviewSchema, STATIONS } from '../../src/lifecycle.js';

describe('STATIONS', () => {
  test('is the seven-station pipeline in order (SDD-024/PRD-011 §4.3)', () => {
    expect(STATIONS).toEqual(['entrada', 'caso_negocio', 'producto', 'diseno_tecnico', 'planificacion', 'construccion', 'entregado']);
  });
});

describe('featureLineSchema', () => {
  const valid = {
    id: 'PRD-001',
    kind: 'PRD',
    title: 'Graph Engine',
    status: 'approved',
    station: 'diseno_tecnico',
    progress: { done: 1, total: 3, stopped: 0 },
  };

  test('accepts a valid feature line without andonStation', () => {
    expect(featureLineSchema.parse(valid)).toEqual(valid);
  });

  test('accepts an optional andonStation', () => {
    const parsed = featureLineSchema.parse({ ...valid, andonStation: 'construccion' });
    expect(parsed.andonStation).toBe('construccion');
  });

  test('rejects an invalid station', () => {
    expect(() => featureLineSchema.parse({ ...valid, station: 'bogus' })).toThrow();
  });

  test('rejects an invalid kind', () => {
    expect(() => featureLineSchema.parse({ ...valid, kind: 'SDD' })).toThrow();
  });

  test('rejects a missing progress field', () => {
    const { progress: _progress, ...withoutProgress } = valid;
    expect(() => featureLineSchema.parse(withoutProgress)).toThrow();
  });
});

describe('lineBoardSchema', () => {
  const feature = {
    id: 'PRD-001',
    kind: 'PRD',
    title: 'Graph Engine',
    status: 'approved',
    station: 'diseno_tecnico',
    progress: { done: 0, total: 0, stopped: 0 },
  };

  test('accepts a board with no andon', () => {
    const parsed = lineBoardSchema.parse({ features: [feature], andon: null });
    expect(parsed.andon).toBeNull();
  });

  test('accepts a board with an andon pointing at a feature/station pair', () => {
    const parsed = lineBoardSchema.parse({ features: [feature], andon: { featureId: 'PRD-001', station: 'diseno_tecnico' } });
    expect(parsed.andon).toEqual({ featureId: 'PRD-001', station: 'diseno_tecnico' });
  });

  test('rejects an andon with an invalid station', () => {
    expect(() => lineBoardSchema.parse({ features: [feature], andon: { featureId: 'PRD-001', station: 'bogus' } })).toThrow();
  });
});

describe('projectOverviewSchema', () => {
  const valid = {
    id: 'proj-1',
    slug: 'roadmap',
    name: 'Roadmap',
    graphProjectId: 'prj_0123456789abcdef',
    settings: {},
    archivedAt: null,
    docCount: 12,
    furthestStation: 'construccion',
    andonStation: null,
    driftErrors: 0,
    driftWarnings: 2,
    awaitingFirstReport: false,
    workOrdersInProgress: 3,
    myRole: 'admin',
    lastActivityAt: '2026-09-01T00:00:00.000Z',
  };

  test('accepts a full project overview and fills in project-summary defaults', () => {
    const parsed = projectOverviewSchema.parse(valid);
    expect(parsed.settings.default_branch).toBe('main');
    expect(parsed.docCount).toBe(12);
    expect(parsed.furthestStation).toBe('construccion');
  });

  test('accepts a null andonStation and lastActivityAt', () => {
    const parsed = projectOverviewSchema.parse({ ...valid, andonStation: null, lastActivityAt: null });
    expect(parsed.andonStation).toBeNull();
    expect(parsed.lastActivityAt).toBeNull();
  });

  test('rejects an invalid furthestStation', () => {
    expect(() => projectOverviewSchema.parse({ ...valid, furthestStation: 'bogus' })).toThrow();
  });

  test('rejects a missing project-summary field', () => {
    const { slug: _slug, ...withoutSlug } = valid;
    expect(() => projectOverviewSchema.parse(withoutSlug)).toThrow();
  });

  test('rejects a missing lifecycle field', () => {
    const { docCount: _docCount, ...withoutDocCount } = valid;
    expect(() => projectOverviewSchema.parse(withoutDocCount)).toThrow();
  });
});
