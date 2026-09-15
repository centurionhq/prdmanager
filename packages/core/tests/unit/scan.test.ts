import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import { afterEach, describe, expect, test } from 'vitest';
import { scanContents, scanDocuments } from '../../src/parser/scan.js';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

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

  test('collects ids from every frontmatter file, including ones that failed validation or are duplicates, for id-reservation purposes', async () => {
    root = makeTmpDir();
    writeFiles(root, {
      'PRD-001.md': '---\nid: PRD-001\ntype: PRD\ntitle: P\n---\nbody',
      'docs/bad.md': '---\nid: WO-003\ntype: WO\ntitle: missing implements\n---\n',
      'docs/dup.md': '---\nid: PRD-001\ntype: PRD\ntitle: Dup\n---\n',
      'docs/quoted.md': "---\nid: 'FR-002'\ntype: FR\ntitle: quoted id\nevolves_from: [PRD-001]\n---\n",
    });
    const result = await scanDocuments(root, []);
    expect(result.ids.sort()).toEqual(['FR-002', 'PRD-001', 'PRD-001', 'WO-003']);
  });

  test('excludes a nested project (its own .prdm.yaml) entirely, ids included (WO-017)', async () => {
    root = makeTmpDir();
    writeFiles(root, {
      'PRD-001.md': '---\nid: PRD-001\ntype: PRD\ntitle: P\n---\nbody',
      'packages/sub/.prdm.yaml': 'version: 1\n',
      'packages/sub/docs/PRD-999.md': '---\nid: PRD-999\ntype: PRD\ntitle: nested\n---\n',
      'packages/sub/docs/bad.md': '---\nid: WO-777\ntype: WO\ntitle: also nested and invalid\n---\n',
    });
    const result = await scanDocuments(root, []);
    expect(result.docs.map((d) => d.node.id)).toEqual(['PRD-001']);
    expect(result.errors).toEqual([]);
    expect(result.ids).toEqual(['PRD-001']);
  });
});

describe('scanContents equivalence with scanDocuments (WO-123)', () => {
  test('produces the exact same ScanResult as scanDocuments for the same files on disk', async () => {
    root = makeTmpDir();
    writeFiles(root, {
      'README.md': '# readme',
      'PRD-001.md': '---\nid: PRD-001\ntype: PRD\ntitle: P\n---\nbody',
      'docs/mrd/MRD-001.md': '---\nid: MRD-001\ntype: MRD\ntitle: M\n---\nbody',
      'docs/bad.md': '---\nid: WO-001\ntype: WO\ntitle: missing implements\n---\n',
      'docs/dup.md': '---\nid: PRD-001\ntype: PRD\ntitle: Dup\n---\n',
      'docs/quoted.md': "---\nid: 'FR-002'\ntype: FR\ntitle: quoted id\nevolves_from: [PRD-001]\n---\n",
      'node_modules/pkg/PRD-999.md': '---\nid: PRD-999\ntype: PRD\ntitle: ignored\n---\n',
    });

    const viaScanDocuments = await scanDocuments(root, ['node_modules/**']);

    const files = (await fg.glob('**/*.md', { cwd: root, ignore: ['node_modules/**'], onlyFiles: true, dot: false })).sort();
    const contents = await Promise.all(files.map(async (path) => ({ path, content: await readFile(`${root}/${path}`, 'utf8') })));
    const viaScanContents = scanContents(contents);

    expect(viaScanContents).toEqual(viaScanDocuments);
  });

  test('is pure: same input always yields the same output, independent of call order', () => {
    const files = [
      { path: 'a.md', content: '---\nid: PRD-001\ntype: PRD\ntitle: A\n---\nbody' },
      { path: 'b.md', content: '---\nid: PRD-001\ntype: PRD\ntitle: B\n---\nbody' },
      { path: 'c.md', content: 'not frontmatter' },
    ];
    expect(scanContents(files)).toEqual(scanContents(files));
  });
});
