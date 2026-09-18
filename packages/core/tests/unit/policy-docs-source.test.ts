/**
 * The `PolicyDocsSource` seam (SDD-010 "Política Refs:", WO-196): `checkCommitMessage`/`checkCommitRange`
 * actually use whatever `source` they're given — proven here by injecting a fake source that claims a
 * blueprint/work-order pair the real git history has no markdown for at all, and confirming that alone is
 * enough to make an otherwise-blocked commit pass.
 */
import { renderProjectFile, type ProjectFileSettings } from '@prdm/core';
import { checkCommitMessage, type PolicyDocsSource } from '@prdm/core';
import { commitAll, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const DEFAULTS: Omit<ProjectFileSettings, 'project'> = {
  docsDir: 'docs',
  folders: { MRD: 'docs/mrd', PRD: 'docs/prd', FR: 'docs/fr', BC: 'docs/business-case', SDD: 'docs/sdd', ADR: 'docs/adr', WO: 'docs/work-orders', ART: 'docs/artifacts', FB: 'docs/feedback' },
  ignore: [],
  git: { maxCommits: 500, enforceRefs: true, enforceRefsSince: null },
  triage: { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 },
  lifecycle: { grandfathered: [] },
  authoring: { draftTtlMinutes: 60, maxDrafts: 20, maxDraftBytes: 262_144 },
};

function fakeSourceWithOpenWorkOrder(): PolicyDocsSource {
  return {
    async policyDocsAt() {
      return [
        { type: 'SDD', id: 'SDD-001', impactsPaths: ['src/**'] },
        { type: 'WO', id: 'WO-001', status: 'pending', implements: ['SDD-001'] },
      ];
    },
    async nestedProjectRootsAt() {
      return [];
    },
    async settingsAt() {
      return null;
    },
  };
}

function emptySource(): PolicyDocsSource {
  return {
    async policyDocsAt() {
      return [];
    },
    async nestedProjectRootsAt() {
      return [];
    },
    async settingsAt() {
      return null;
    },
  };
}

let root: string;

beforeEach(() => {
  root = makeTmpDir('prdm-policy-source-');
  writeFiles(root, {
    '.prdm.yaml': renderProjectFile({ project: { id: 'prj_0123456789abcdef', name: 'x' }, ...DEFAULTS }),
    'src/foo.ts': 'export const x = 1;\n',
  });
  gitInit(root);
  commitAll(root, 'chore: init');
  writeFiles(root, { 'src/foo.ts': 'export const x = 2;\n' });
  execFileSync('git', ['add', '-A'], { cwd: root });
});

afterEach(() => {
  removeDir(root);
});

describe('PolicyDocsSource seam (WO-196)', () => {
  test('a fake source that claims an open work order governs the change makes the commit pass', async () => {
    const result = await checkCommitMessage(root, 'chore: touch foo', {}, fakeSourceWithOpenWorkOrder());
    expect(result.ok).toBe(false); // no "Refs:" trailer in the message yet
    expect(result.requiredFor).toEqual(['src/foo.ts']);

    const withRefs = await checkCommitMessage(root, 'chore: touch foo\n\nRefs: WO-001', {}, fakeSourceWithOpenWorkOrder());
    expect(withRefs.ok).toBe(true);
  });

  test('a fake source with no documents at all never requires a Refs: trailer', async () => {
    const result = await checkCommitMessage(root, 'chore: touch foo', {}, emptySource());
    expect(result.ok).toBe(true);
    expect(result.requiredFor).toEqual([]);
  });

  test('the default (git-backed) source sees none of the fake source\'s documents', async () => {
    // Same repo, same staged change, no `source` argument: falls back to GitPolicyDocsSource, which
    // finds no real markdown documents in this fixture at all — so nothing is governed.
    const result = await checkCommitMessage(root, 'chore: touch foo');
    expect(result.ok).toBe(true);
    expect(result.requiredFor).toEqual([]);
  });
});
