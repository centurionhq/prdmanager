/**
 * `wo list` / `wo context` print the document path that exists on disk (SDD-074 D3, WO-650): the
 * `.prdm/remote` mirror when present, else the canonical published path, declaring the other one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorkOrderContext, WorkOrderSummary } from '@prdm/core';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { formatWorkOrderContext, formatWorkOrderDocPaths, formatWorkOrderLine } from '../../src/commands/workorders.js';

const SOURCE = 'docs/work-orders/WO-001-x.md';
const MIRROR = '.prdm/remote/docs/WO-001.md';

const wo = {
  id: 'WO-001',
  title: 'Do the thing',
  status: 'open',
  assignedTo: null,
  blueprints: ['SDD-001'],
  sourcePath: SOURCE,
  mirrorPath: MIRROR,
  acceptanceCriteria: [],
} as unknown as WorkOrderSummary;

function touch(root: string, rel: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), '# doc\n');
}

describe('formatWorkOrderDocPaths (WO-650)', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => removeDir(root));

  test('prefers the mirror and marks the canonical path when both exist', () => {
    touch(root, MIRROR);
    touch(root, SOURCE);
    expect(formatWorkOrderDocPaths(root, wo)).toBe(`${MIRROR}  ${SOURCE} (canonica)`);
  });

  test('falls back to the canonical path when only it exists', () => {
    touch(root, SOURCE);
    expect(formatWorkOrderDocPaths(root, wo)).toBe(`${SOURCE}  ${MIRROR} (sin copia local)`);
  });

  test('still prints the canonical path when neither exists on disk', () => {
    expect(formatWorkOrderDocPaths(root, wo)).toBe(`${SOURCE}  ${MIRROR} (sin copia local)`);
  });

  test('wo list line carries the helper output plus id, status and title', () => {
    touch(root, MIRROR);
    const line = formatWorkOrderLine(wo, root);
    expect(line).toContain(formatWorkOrderDocPaths(root, wo));
    expect(line).toContain('WO-001');
    expect(line).toContain('open');
    expect(line.endsWith('Do the thing')).toBe(true);
  });

  test('wo context prints a document: line right after the header', () => {
    touch(root, MIRROR);
    const context = {
      workOrder: wo,
      blueprints: [],
      featureLineage: [],
      code: [],
      commits: [],
      instructions: 'go',
    } as unknown as WorkOrderContext;
    const lines = formatWorkOrderContext(context, root).split('\n');
    expect(lines[1]).toBe(`document: ${formatWorkOrderDocPaths(root, wo)}`);
  });
});
