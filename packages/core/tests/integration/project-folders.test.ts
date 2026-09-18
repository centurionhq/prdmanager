import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { attachArtifact } from '../../src/artifacts/ingest.js';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import { createFeatureRequest, submitFeedback } from '../../src/feedback/ingest.js';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import { generateProjectId, renderProjectFile, type ProjectFileSettings } from '../../src/project/file.js';
import { DEFAULT_AUTHORING, DEFAULT_GIT, DEFAULT_LIFECYCLE, type FolderMap } from '../../src/project/types.js';
import { generateWorkOrders } from '../../src/workorders/generator.js';
import { createFixtureRepo, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';

const CUSTOM_FOLDERS: FolderMap = {
  MRD: 'docs/mrd',
  PRD: 'docs/prd',
  FR: 'docs/requests',
  BC: 'docs/business-case',
  SDD: 'docs/sdd',
  ADR: 'docs/adr',
  WO: 'docs/tasks',
  FB: 'docs/inbox',
  ART: 'docs/attachments',
};

let root: string;
let config: PrdmConfig;
let db: Neo4jGraphDatabase;
let store: GraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  const settings: ProjectFileSettings = {
    project: { id: generateProjectId(), name: 'custom-folders' },
    docsDir: 'docs',
    folders: CUSTOM_FOLDERS,
    ignore: [],
    git: DEFAULT_GIT,
    triage: { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 },
    lifecycle: DEFAULT_LIFECYCLE,
    authoring: DEFAULT_AUTHORING,
  };
  writeFiles(root, { '.prdm.yaml': renderProjectFile(settings) });
  config = testConfig(root);
  expect(config.folders).toEqual(CUSTOM_FOLDERS);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
  await engine.refresh();
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('writers honor a custom folder map from .prdm.yaml (WO-017)', () => {
  test('submitFeedback writes under folders.FB', async () => {
    const result = await submitFeedback(engine, { text: 'algo sin relación con nada existente en el sistema', source: 'chat' });
    expect(result.path.startsWith('docs/inbox/FB-001')).toBe(true);
  });

  test('createFeatureRequest writes under folders.FR', async () => {
    // PRD-002 §3 (WO-019): justified_by (or the legacy feedback_id, used here) is now required.
    const result = await createFeatureRequest(engine, { title: 'Nueva petición', description: 'Detalle de la petición', parentId: 'PRD-001', feedbackId: 'FB-001' });
    expect(result.path.startsWith('docs/requests/FR-001')).toBe(true);
  });

  test('attachArtifact writes under folders.ART', async () => {
    const result = await attachArtifact(engine, { title: 'Nota', content: 'Contexto sobre PRD-001.', source: 'meeting' });
    expect(result.path.startsWith('docs/attachments/ART-002')).toBe(true);
  });

  test('generateWorkOrders writes under folders.WO', async () => {
    const result = await generateWorkOrders(engine, 'SDD-001');
    expect(result.created.every((wo) => wo.path.startsWith('docs/tasks/'))).toBe(true);
    expect(result.created.length).toBeGreaterThan(0);
  });
});
