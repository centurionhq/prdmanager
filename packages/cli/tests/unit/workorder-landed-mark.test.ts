/** `wo list` marks an order whose commit already landed in the graph (SDD-076 D2), without closing it. */
import type { WorkOrderSummary } from '@prdm/core';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { formatWorkOrderLine } from '../../src/commands/workorders.js';

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

const wo = {
  id: 'WO-001',
  title: 'Do the thing',
  status: 'pending',
  assignedTo: null,
  blueprints: ['SDD-001'],
  sourcePath: 'docs/work-orders/WO-001-x.md',
  mirrorPath: '.prdm/remote/docs/WO-001.md',
} as unknown as WorkOrderSummary;

describe('formatWorkOrderLine landed mark (WO-656)', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => removeDir(root));

  test('a row with a sha carries the 7-char mark and still ends with the title', () => {
    const line = formatWorkOrderLine({ ...wo, landedCommitSha: SHA }, root);
    expect(line).toContain('  ⚠ landed abcdef0  Do the thing');
    expect(line).not.toContain(SHA);
    expect(line.endsWith('Do the thing')).toBe(true);
  });

  test('a row without a sha has no landed mark', () => {
    expect(formatWorkOrderLine(wo, root)).not.toContain('landed');
    expect(formatWorkOrderLine({ ...wo, landedCommitSha: null }, root)).not.toContain('landed');
  });
});
