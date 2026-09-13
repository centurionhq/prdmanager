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
  ['working-directory']?: string;
}

function loadWorkflow(): { permissions?: Record<string, unknown>; jobs: Record<string, { steps: WorkflowStep[] }> } {
  const src = readFileSync(WORKFLOW_PATH, 'utf8');
  const doc = parseDocument(src, { strict: true });
  expect(doc.errors).toEqual([]);
  return doc.toJS() as { permissions?: Record<string, unknown>; jobs: Record<string, { steps: WorkflowStep[] }> };
}

describe('WO-024 finding 1f: prdm-sync.yml builds the Refs: policy checker from the range base', () => {
  test('the workflow is syntactically valid YAML', () => {
    expect(() => loadWorkflow()).not.toThrow();
  });

  test('declares read-only contents permissions at the workflow top level', () => {
    const workflow = loadWorkflow();
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  test('checks out the range base into a separate "prdm-base" path and builds it there', () => {
    const { jobs } = loadWorkflow();
    const steps = jobs['sync-check']?.steps ?? [];
    const baseCheckout = steps.find((s) => s.uses === 'actions/checkout@v4' && s.with?.path === 'prdm-base');
    expect(baseCheckout).toBeDefined();
    expect(baseCheckout?.with?.ref).toBeTruthy();
    expect(baseCheckout?.with?.['fetch-depth']).toBe(0);

    const buildStep = steps.find((s) => s['working-directory'] === 'prdm-base');
    expect(buildStep?.run).toContain('npm ci');
    expect(buildStep?.run).toContain('npm run build');
  });

  test('runs "check commits" using the base-built binary, not the head build', () => {
    const { jobs } = loadWorkflow();
    const steps = jobs['sync-check']?.steps ?? [];
    const checkStep = steps.find((s) => typeof s.run === 'string' && s.run.includes('check commits --range'));
    expect(checkStep).toBeDefined();
    expect(checkStep?.run).toContain('prdm-base/packages/cli/dist/index.js');
    expect(checkStep?.['working-directory']).toBeUndefined(); // runs with the default (PR/head) checkout as cwd
  });

  test('still runs the existing build/typecheck/test/migrate/sync steps against the head checkout', () => {
    const { jobs } = loadWorkflow();
    const steps = jobs['sync-check']?.steps ?? [];
    const runs = steps.filter((s) => typeof s.run === 'string' && s['working-directory'] === undefined).map((s) => s.run as string);
    expect(runs.some((r) => r === 'npm run build')).toBe(true);
    expect(runs.some((r) => r === 'npm run typecheck')).toBe(true);
    expect(runs.some((r) => r === 'npm run test:unit')).toBe(true);
    expect(runs.some((r) => r.includes('db migrate'))).toBe(true);
    expect(runs.some((r) => r.includes('sync --check'))).toBe(true);
  });
});
