import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { describe, expect, test } from 'vitest';

const WORKFLOW_PATH = resolve(import.meta.dirname, '../../../../.github/workflows/prdm-sync.yml');

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  ['working-directory']?: string;
}

function loadWorkflow(): { permissions?: Record<string, unknown>; jobs: Record<string, { steps: WorkflowStep[] }> } {
  const src = readFileSync(WORKFLOW_PATH, 'utf8');
  const doc = parseDocument(src, { strict: true });
  expect(doc.errors).toEqual([]);
  return doc.toJS() as { permissions?: Record<string, unknown>; jobs: Record<string, { steps: WorkflowStep[] }> };
}

describe('SDD-010 "Modo remoto": prdm-sync.yml reports to this project\'s own remote server', () => {
  test('the workflow is syntactically valid YAML', () => {
    expect(() => loadWorkflow()).not.toThrow();
  });

  test('declares read-only contents plus id-token: write at the workflow top level (needed to request a real GitHub Actions OIDC token)', () => {
    const workflow = loadWorkflow();
    expect(workflow.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
  });

  test('runs build/typecheck/test:unit against the head checkout, with no separate range-base checkout or rebuild', () => {
    const { jobs } = loadWorkflow();
    const steps = jobs['sync-check']?.steps ?? [];
    expect(steps.some((s) => s.uses === 'actions/checkout@v4' && s.with?.path === 'prdm-base')).toBe(false);

    const runs = steps.filter((s) => typeof s.run === 'string').map((s) => s.run as string);
    expect(runs.some((r) => r === 'npm run build')).toBe(true);
    expect(runs.some((r) => r === 'npm run typecheck')).toBe(true);
    expect(runs.some((r) => r === 'npm run test:unit')).toBe(true);
    expect(runs.some((r) => r.includes('db migrate'))).toBe(false);
    expect(runs.some((r) => r.includes('check commits --range'))).toBe(false);
  });

  test('reports to PRDM_SERVER/PRDM_TOKEN from repository secrets, never a hardcoded value', () => {
    const { jobs } = loadWorkflow();
    const steps = jobs['sync-check']?.steps ?? [];
    const syncStep = steps.find((s) => typeof s.run === 'string' && s.run.includes('sync --check'));
    expect(syncStep, 'sync-check must have a step running "sync --check"').toBeDefined();
    expect(syncStep?.env?.PRDM_SERVER).toBe('${{ secrets.PRDM_SERVER }}');
    expect(syncStep?.env?.PRDM_TOKEN).toBe('${{ secrets.PRDM_TOKEN }}');
    expect(syncStep?.env?.PRDM_PROJECT_ID).toBe('${{ secrets.PRDM_PROJECT_ID }}');
  });
});
