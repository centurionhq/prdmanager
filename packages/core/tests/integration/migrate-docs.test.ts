import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import {
  Engine,
  contentHash,
  migrateDocs,
  normalizeText,
  parseDocument,
  saveBaseline,
  sha256,
  type Baseline,
  type GraphStore,
  type Neo4jGraphDatabase,
  type ParsedDoc,
  type PrdmConfig,
} from '@prdm/core';
import { commitAll, gitInit, makeTmpDir, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';

let root = '';
let config: PrdmConfig;
let db: Neo4jGraphDatabase | undefined;
let store: GraphStore;
let engine: Engine;

afterEach(async () => {
  await db?.close();
  db = undefined;
  if (root) removeDir(root);
});

function parse(content: string, path: string): ParsedDoc {
  const result = parseDocument(content, path);
  if (!result?.ok) throw new Error(`fixture invalid: ${result ? result.error : 'no frontmatter'}`);
  return result.doc;
}

/**
 * A pre-migration repo: `governs`/`status: todo` still on disk, and `.prdm/baseline.json` seeded as if it had
 * been written by the pre-D9 (tasks-included) hash algorithm. SDD-001/WO-001 are in sync; SDD-002 was already
 * drifted (its design changed) before the migration ever runs, and must stay drifted after it.
 */
async function setUpPreMigrationRepo(): Promise<void> {
  root = makeTmpDir('prdm-migrate-');

  const sdd1Content = '---\nid: SDD-001\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-001"]\ngoverns: ["src/a.ts"]\n---\ndesign\n\n## Tareas\n- [ ] hacer algo\n';
  const sdd2Content = '---\nid: SDD-002\ntype: SDD\ntitle: "Design 2"\narchitects: ["PRD-001"]\ngoverns: ["src/b.ts"]\n---\ndesign v1\n\n## Tareas\n- [ ] otra cosa\n';
  const sdd2OldContent = sdd2Content.replace('design v1', 'design v0');
  const aContent = 'export const a = 1;\n';
  const bContent = 'export const b = 1;\n';

  const sdd1 = parse(sdd1Content, 'docs/blueprints/SDD-001.md');
  const sdd2Old = parse(sdd2OldContent, 'docs/blueprints/SDD-002.md');
  const legacyHash1 = contentHash(sdd1.frontmatter, sdd1.node.body, { includeTasks: true });
  const legacyHash2Old = contentHash(sdd2Old.frontmatter, sdd2Old.node.body, { includeTasks: true });

  const mrdContent = '---\nid: MRD-001\ntype: MRD\ntitle: "Market"\nstatus: approved\n---\ncontext\n';
  const prdContent = '---\nid: PRD-001\ntype: PRD\ntitle: "Product"\nimplements: ["MRD-001"]\n---\nproduct body\n';
  const wo1Content = `---\nid: WO-001\ntype: WO\ntitle: "Tarea uno"\nstatus: done\nimplements: ["SDD-001"]\ngoverns: ["src/a.ts"]\nblueprint_hashes: {"SDD-001":"${legacyHash1}"}\n---\nobjetivo\n`;
  const wo2Content = '---\nid: WO-002\ntype: WO\ntitle: "Tarea dos"\nstatus: todo\nimplements: ["SDD-002"]\n---\nobjetivo\n';

  writeFiles(root, {
    'docs/mrd/MRD-001.md': mrdContent,
    'PRD-001.md': prdContent,
    'docs/blueprints/SDD-001.md': sdd1Content,
    'docs/blueprints/SDD-002.md': sdd2Content,
    'docs/work-orders/WO-001.md': wo1Content,
    'docs/work-orders/WO-002.md': wo2Content,
    'src/a.ts': aContent,
    'src/b.ts': bContent,
  });
  gitInit(root);
  commitAll(root, 'chore: initial docs');

  const mrd = parse(mrdContent, 'docs/mrd/MRD-001.md');
  const prd = parse(prdContent, 'PRD-001.md');
  const wo1 = parse(wo1Content, 'docs/work-orders/WO-001.md');
  const wo2 = parse(wo2Content, 'docs/work-orders/WO-002.md');

  const preMigrationBaseline: Baseline = {
    version: 1,
    docs: {
      'MRD-001': mrd.node.contentHash,
      'PRD-001': prd.node.contentHash,
      'SDD-001': legacyHash1,
      'SDD-002': legacyHash2Old,
      'WO-001': wo1.node.contentHash,
      'WO-002': wo2.node.contentHash,
    },
    governs: {
      'SDD-001': { 'src/a.ts': sha256(normalizeText(aContent)) },
      'SDD-002': { 'src/b.ts': sha256(normalizeText(bContent)) },
    },
  };
  await saveBaseline(root, preMigrationBaseline);

  config = testConfig(root);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
}

describe('migrateDocs (integration)', () => {
  test('rewrites legacy aliases and re-baselines only synced blueprints; a genuinely drifted one stays drifted', async () => {
    await setUpPreMigrationRepo();

    const issuesFor = (nodeId: string, issues: { kind: string; nodeId: string }[]) =>
      issues
        .filter((i) => i.nodeId === nodeId)
        .map((i) => i.kind)
        .sort();

    // `prdm migrate docs` must run before the first `prdm sync` on a legacy repo: a raw refresh here (old baseline,
    // new tasks-excluded algorithm) would itself flag SDD-001 as blueprint_changed and flip WO-001 to out_of_sync,
    // which is exactly what the migration below prevents by re-baselining first.
    const sdd1Before = readFileSync(`${root}/docs/blueprints/SDD-001.md`, 'utf8');
    const baselineBefore = readFileSync(`${root}/.prdm/baseline.json`, 'utf8');

    const dryRun = await migrateDocs(engine, { dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.report).toBeUndefined();
    expect(dryRun.fieldChanges.map((c) => c.id).sort()).toEqual(['SDD-001', 'SDD-002', 'WO-001', 'WO-002']);
    expect(dryRun.rebaselinedBlueprints).toEqual(['SDD-001']);
    expect(dryRun.rebaselinedWorkOrders).toEqual(['WO-001']);
    // A dry run writes nothing.
    expect(readFileSync(`${root}/docs/blueprints/SDD-001.md`, 'utf8')).toBe(sdd1Before);
    expect(readFileSync(`${root}/.prdm/baseline.json`, 'utf8')).toBe(baselineBefore);

    const applied = await migrateDocs(engine);
    expect(applied.dryRun).toBe(false);
    expect(applied.fieldChanges.map((c) => c.id).sort()).toEqual(['SDD-001', 'SDD-002', 'WO-001', 'WO-002']);
    expect(applied.rebaselinedBlueprints).toEqual(['SDD-001']);
    expect(applied.rebaselinedWorkOrders).toEqual(['WO-001']);
    expect(readFileSync(`${root}/docs/blueprints/SDD-001.md`, 'utf8')).toContain('impacts_paths: ["src/a.ts"]');
    expect(readFileSync(`${root}/docs/blueprints/SDD-001.md`, 'utf8')).not.toContain('governs');
    expect(readFileSync(`${root}/docs/work-orders/WO-002.md`, 'utf8')).toContain('status: "pending"');

    const after = applied.report!;
    expect(issuesFor('SDD-001', after.issues)).toEqual([]);
    expect(issuesFor('WO-001', after.issues)).toEqual([]);
    expect(issuesFor('SDD-002', after.issues)).toEqual(['blueprint_changed', 'code_out_of_sync'].sort());
    expect(issuesFor('WO-002', after.issues)).toEqual([]);
    expect(readFileSync(`${root}/docs/work-orders/WO-001.md`, 'utf8')).toContain('status: done');

    const again = await migrateDocs(engine);
    expect(again.fieldChanges).toEqual([]);
    expect(again.rebaselinedBlueprints).toEqual([]);
    expect(again.rebaselinedWorkOrders).toEqual([]);
  });
});
