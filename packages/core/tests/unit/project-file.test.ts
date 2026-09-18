import { describe, expect, test } from 'vitest';
import {
  MAX_PROJECT_FILE_BYTES,
  generateProjectId,
  parseProjectFile,
  renderProjectFile,
  type ProjectFileSettings,
} from '../../src/project/file.js';
import { DEFAULT_AUTHORING, DEFAULT_FOLDERS, DEFAULT_GIT, DEFAULT_LIFECYCLE, PROJECT_ID_PATTERN } from '../../src/project/types.js';

const VALID_ID = 'prj_0123456789abcdef';

const FULL_YAML = `
version: 1
project:
  id: ${VALID_ID}
  name: prdmanager
docs_dir: docs
folders:
  MRD: docs/mrd
  PRD: docs/prd
  FR: docs/fr
  SDD: docs/sdd
  ADR: docs/adr
  WO: docs/work-orders
  FB: docs/feedback
  ART: docs/artifacts
ignore:
  - node_modules/**
git:
  max_commits: 200
  enforce_refs: true
  enforce_refs_since: abc1234
triage:
  auto_link_min_score: 0.6
  auto_link_margin: 1.1
  max_candidates: 3
  min_matched_terms: 1
lifecycle:
  grandfathered:
    - id: MRD-001
      hash: ${'a'.repeat(64)}
authoring:
  draft_ttl_minutes: 30
  max_drafts: 10
  max_draft_bytes: 4096
`;

describe('parseProjectFile', () => {
  test('parses a full, valid file', () => {
    const settings = parseProjectFile(FULL_YAML);
    expect(settings.project).toEqual({ id: VALID_ID, name: 'prdmanager' });
    expect(settings.docsDir).toBe('docs');
    expect(settings.folders).toEqual({
      MRD: 'docs/mrd',
      PRD: 'docs/prd',
      FR: 'docs/fr',
      BC: 'docs/business-case',
      SDD: 'docs/sdd',
      ADR: 'docs/adr',
      WO: 'docs/work-orders',
      FB: 'docs/feedback',
      ART: 'docs/artifacts',
    });
    expect(settings.ignore).toEqual(['node_modules/**']);
    expect(settings.git).toEqual({ maxCommits: 200, enforceRefs: true, enforceRefsSince: 'abc1234' });
    expect(settings.triage).toEqual({ autoLinkMinScore: 0.6, autoLinkMargin: 1.1, maxCandidates: 3, minMatchedTerms: 1 });
    expect(settings.lifecycle.grandfathered).toEqual([{ id: 'MRD-001', hash: 'a'.repeat(64) }]);
    expect(settings.authoring).toEqual({ draftTtlMinutes: 30, maxDrafts: 10, maxDraftBytes: 4096 });
  });

  test('applies documented defaults when only the required fields are present', () => {
    const settings = parseProjectFile(`version: 1\nproject:\n  id: ${VALID_ID}\n  name: minimal\n`);
    expect(settings.docsDir).toBe('docs');
    expect(settings.folders).toEqual(DEFAULT_FOLDERS);
    expect(settings.ignore).toEqual([]);
    expect(settings.git).toEqual(DEFAULT_GIT);
    expect(settings.triage).toEqual({ autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 });
    expect(settings.lifecycle).toEqual(DEFAULT_LIFECYCLE);
    expect(settings.authoring).toEqual(DEFAULT_AUTHORING);
  });

  test('merges a partial folder map over the defaults', () => {
    const settings = parseProjectFile(`version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\nfolders:\n  FR: docs/requests\n`);
    expect(settings.folders).toEqual({ ...DEFAULT_FOLDERS, FR: 'docs/requests' });
  });

  test('overriding docs_dir without folders derives every default folder from the new docs_dir (WO-024 finding 8)', () => {
    const settings = parseProjectFile(`version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\ndocs_dir: spec\n`);
    expect(settings.folders).toEqual({
      MRD: 'spec/mrd',
      PRD: 'spec/prd',
      FR: 'spec/fr',
      BC: 'spec/business-case',
      SDD: 'spec/sdd',
      ADR: 'spec/adr',
      WO: 'spec/work-orders',
      FB: 'spec/feedback',
      ART: 'spec/artifacts',
    });
  });

  test('overriding docs_dir with a partial folder map derives the rest from the new docs_dir (WO-024 finding 8)', () => {
    const settings = parseProjectFile(`version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\ndocs_dir: spec\nfolders:\n  FR: spec/requests\n`);
    expect(settings.folders).toEqual({
      MRD: 'spec/mrd',
      PRD: 'spec/prd',
      FR: 'spec/requests',
      BC: 'spec/business-case',
      SDD: 'spec/sdd',
      ADR: 'spec/adr',
      WO: 'spec/work-orders',
      FB: 'spec/feedback',
      ART: 'spec/artifacts',
    });
  });

  test('rejects files larger than 64 KiB', () => {
    const big = `version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\nignore:\n${'  - x\n'.repeat(20_000)}`;
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(MAX_PROJECT_FILE_BYTES);
    expect(() => parseProjectFile(big)).toThrow(/\.prdm\.yaml is invalid.*exceeds/s);
  });

  test('rejects YAML anchors and aliases', () => {
    const src = `version: 1\nproject: &p\n  id: ${VALID_ID}\n  name: p\n`;
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid.*anchor/is);

    const withAlias = `version: 1\nproject: &p\n  id: ${VALID_ID}\n  name: p\nignore: [*p]\n`;
    expect(() => parseProjectFile(withAlias)).toThrow(/\.prdm\.yaml is invalid/);
  });

  test('rejects custom/unresolved YAML tags such as !!js/function', () => {
    const src = `version: 1\nproject:\n  id: ${VALID_ID}\n  name: !!js/function "function(){}"\n`;
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid.*tag/is);
  });

  test('rejects duplicate keys', () => {
    const src = `version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\nproject:\n  id: ${VALID_ID}\n  name: q\n`;
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid/);
  });

  test('rejects a non-mapping root', () => {
    expect(() => parseProjectFile('- 1\n- 2\n')).toThrow(/\.prdm\.yaml is invalid.*mapping/is);
  });

  test('rejects unknown top-level keys', () => {
    const src = `version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\nunknown_field: 1\n`;
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid/);
  });

  test.each(['neo4j', 'password', 'neo4j_uri', 'db_password', 'api_secret'])('rejects a top-level %s key with a secrets-belong-in-.env message', (key) => {
    const src = `version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\n${key}: whatever\n`;
    expect(() => parseProjectFile(src)).toThrow(/secrets belong in \.env/);
  });

  test('rejects an invalid project id', () => {
    const src = `version: 1\nproject:\n  id: not-a-project-id\n  name: p\n`;
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid/);
  });

  test.each(['../outside', '/absolute/path', 'other-dir/mrd', 'docs/../escape'])('rejects a folder path traversing outside docs_dir: %s', (folder) => {
    const src = `version: 1\nproject:\n  id: ${VALID_ID}\n  name: p\nfolders:\n  MRD: ${folder}\n`;
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid/);
  });

  test('rejects a name containing a newline', () => {
    const src = `version: 1\nproject:\n  id: ${VALID_ID}\n  name: "line one\\nline two"\n`;
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid/);
  });
});

describe('renderProjectFile / parseProjectFile round trip', () => {
  test('renders deterministic YAML that parses back to the same settings', () => {
    const settings: ProjectFileSettings = {
      project: { id: VALID_ID, name: 'roundtrip' },
      docsDir: 'docs',
      folders: DEFAULT_FOLDERS,
      ignore: ['node_modules/**', 'dist/**'],
      git: { maxCommits: 123, enforceRefs: false, enforceRefsSince: 'deadbee' },
      triage: { autoLinkMinScore: 0.7, autoLinkMargin: 1.2, maxCandidates: 4, minMatchedTerms: 3 },
      lifecycle: { grandfathered: [{ id: 'ADR-001', hash: 'b'.repeat(64) }] },
      authoring: { draftTtlMinutes: 45, maxDrafts: 15, maxDraftBytes: 8192 },
    };

    const rendered = renderProjectFile(settings);
    expect(parseProjectFile(rendered)).toEqual(settings);
    expect(rendered).toBe(renderProjectFile(settings));
  });
});

describe('generateProjectId', () => {
  test('matches the prj_ + 16 hex format', () => {
    const id = generateProjectId();
    expect(id).toMatch(PROJECT_ID_PATTERN);
  });

  test('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateProjectId()));
    expect(ids.size).toBe(50);
  });

  test('accepts an injectable random source', () => {
    const id = generateProjectId(() => Buffer.from('00'.repeat(8), 'hex'));
    expect(id).toBe('prj_0000000000000000');
  });
});
