/**
 * Enriched drift-issue and report-detail DTO validation (SDD-012, WO-326): `driftIssueDtoSchema` adds
 * feature/blueprint/station attribution (WO-329's `attributeIssue`) on top of `@prdm/core`'s bare
 * `DriftIssue`, and `driftReportDetailSchema` is a report summary plus its full issue list.
 */
import { describe, expect, test } from 'vitest';
import { driftIssueDtoSchema, driftReportDetailSchema } from '../../src/drift.js';

describe('driftIssueDtoSchema', () => {
  const valid = {
    kind: 'feature_changed',
    severity: 'error' as const,
    nodeId: 'PRD-001',
    message: 'PRD-001 changed',
    id: 'a1b2c3d4e5f6a1b2',
    featureIds: ['PRD-001'],
    blueprintId: null,
    station: 'definicion',
    detectedAt: '2026-09-01T00:00:00.000Z',
  };

  test('accepts a full issue with an optional target', () => {
    const parsed = driftIssueDtoSchema.parse({ ...valid, target: 'SDD-001' });
    expect(parsed.target).toBe('SDD-001');
  });

  test('accepts a null blueprintId/station', () => {
    const parsed = driftIssueDtoSchema.parse({ ...valid, station: null });
    expect(parsed.blueprintId).toBeNull();
    expect(parsed.station).toBeNull();
  });

  test('rejects a non-hex id', () => {
    expect(() => driftIssueDtoSchema.parse({ ...valid, id: 'not-hex!' })).toThrow();
  });

  test('rejects an invalid station', () => {
    expect(() => driftIssueDtoSchema.parse({ ...valid, station: 'bogus' })).toThrow();
  });

  test('rejects an invalid severity', () => {
    expect(() => driftIssueDtoSchema.parse({ ...valid, severity: 'fatal' })).toThrow();
  });
});

describe('driftReportDetailSchema', () => {
  const issue = {
    kind: 'feature_changed',
    severity: 'error' as const,
    nodeId: 'PRD-001',
    message: 'PRD-001 changed',
    id: 'a1b2c3d4e5f6a1b2',
    featureIds: ['PRD-001'],
    blueprintId: null,
    station: null,
    detectedAt: '2026-09-01T00:00:00.000Z',
  };

  const valid = {
    id: 'report-1',
    mode: 'baseline' as const,
    headSha: 'a'.repeat(40),
    branch: 'main',
    tokenName: 'CI token',
    issueCount: 1,
    hasBlockingIssues: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    issues: [issue],
  };

  test('accepts a report detail with its full issue list', () => {
    const parsed = driftReportDetailSchema.parse(valid);
    expect(parsed.issues).toHaveLength(1);
  });

  test('accepts a null branch', () => {
    const parsed = driftReportDetailSchema.parse({ ...valid, branch: null });
    expect(parsed.branch).toBeNull();
  });

  test('rejects an invalid mode', () => {
    expect(() => driftReportDetailSchema.parse({ ...valid, mode: 'bogus' })).toThrow();
  });
});
