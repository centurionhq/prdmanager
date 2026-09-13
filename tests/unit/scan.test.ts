import { afterEach, describe, expect, test } from 'vitest';
import { scanDocuments } from '../../src/parser/scan.js';
import { makeTmpDir, removeDir, writeFiles } from '../helpers/tmp.js';

let root = '';
afterEach(() => root && removeDir(root));

describe('scanDocuments', () => {
  test('collects graph documents, skips plain markdown and ignored dirs, reports errors and duplicates', async () => {
    root = makeTmpDir();
    writeFiles(root, {
      'README.md': '# readme',
      'PRD-001.md': '---\nid: PRD-001\ntype: PRD\ntitle: P\n---\nbody',
      'docs/mrd/MRD-001.md': '---\nid: MRD-001\ntype: MRD\ntitle: M\n---\nbody',
      'docs/bad.md': '---\nid: WO-001\ntype: WO\ntitle: missing implements\n---\n',
      'docs/dup.md': '---\nid: PRD-001\ntype: PRD\ntitle: Dup\n---\n',
      'node_modules/pkg/PRD-999.md': '---\nid: PRD-999\ntype: PRD\ntitle: ignored\n---\n',
    });
    const result = await scanDocuments(root, ['node_modules/**']);
    expect(result.docs.map((d) => d.node.id).sort()).toEqual(['MRD-001', 'PRD-001']);
    expect(result.docs.find((d) => d.node.id === 'MRD-001')?.node.sourcePath).toBe('docs/mrd/MRD-001.md');
    expect(result.errors.map((e) => e.path).sort()).toEqual(['docs/bad.md', 'docs/dup.md']);
    expect(result.errors.find((e) => e.path === 'docs/dup.md')?.error).toMatch(/duplicate id PRD-001/);
  });
});
