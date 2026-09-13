import { describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { decideLinks, extractFeatureMentions, proposalTitle, triageText } from '../../src/feedback/triage.js';
import type { GraphStore, NodeDetail, NodeView, SearchHit } from '../../src/graph/types.js';

const triage: PrdmConfig['triage'] = { autoLinkMinScore: 1.5, autoLinkMargin: 1.2, maxCandidates: 5, minMatchedTerms: 2 };

function hit(id: string, score: number): SearchHit {
  return { id, label: 'Feature', title: id, status: 'approved', score };
}

function nodeView(overrides: Partial<NodeView>): NodeView {
  return {
    id: 'PRD-001',
    label: 'Feature',
    kind: 'PRD',
    title: '',
    status: 'approved',
    body: '',
    tags: [],
    source_path: 'PRD-001.md',
    created_at: null,
    ...overrides,
  };
}

interface FakeStore {
  search: GraphStore['search'];
  getNode: GraphStore['getNode'];
}

function fakeStore(overrides: Partial<FakeStore>): GraphStore {
  const store: FakeStore = {
    search: overrides.search ?? (async () => []),
    getNode: overrides.getNode ?? (async () => null),
  };
  return store as GraphStore;
}

function fakeConfig(triageOverrides: Partial<PrdmConfig['triage']> = {}): PrdmConfig {
  return {
    root: '/repo',
    docsDir: 'docs',
    ignore: [],
    gitMaxCommits: 500,
    triage: { ...triage, ...triageOverrides },
    neo4j: { uri: 'neo4j://fake', username: 'neo4j', password: 'x', database: 'neo4j' },
  };
}

describe('extractFeatureMentions', () => {
  test('extracts unique MRD/PRD/FR ids in order of first appearance', () => {
    expect(extractFeatureMentions('See PRD-001 and MRD-001, also PRD-001 again, FR-042')).toEqual(['PRD-001', 'MRD-001', 'FR-042']);
  });

  test('returns an empty array when there are no mentions', () => {
    expect(extractFeatureMentions('no ids here')).toEqual([]);
  });

  test('ignores kinds that are not features (WO, SDD, ART, FB)', () => {
    expect(extractFeatureMentions('WO-001 SDD-001 ART-001 FB-001')).toEqual([]);
  });
});

describe('decideLinks', () => {
  test('explicit mentions win over any candidate score', () => {
    expect(decideLinks(['PRD-001'], [hit('FR-002', 10)], triage)).toEqual({ autoLinkTo: ['PRD-001'], reason: 'mention' });
  });

  test('auto-links the top candidate when score clears the threshold and margin', () => {
    expect(decideLinks([], [hit('PRD-001', 3), hit('FR-002', 2)], triage)).toEqual({ autoLinkTo: ['PRD-001'], reason: 'score' });
  });

  test('does not auto-link when top score is below the minimum', () => {
    expect(decideLinks([], [hit('PRD-001', 1.2)], triage)).toEqual({ autoLinkTo: [], reason: 'none' });
  });

  test('does not auto-link when the runner-up is too close (ambiguous)', () => {
    expect(decideLinks([], [hit('PRD-001', 2), hit('FR-002', 1.8)], triage)).toEqual({ autoLinkTo: [], reason: 'none' });
  });

  test('auto-links a lone candidate above threshold with no runner-up', () => {
    expect(decideLinks([], [hit('PRD-001', 1.5)], triage)).toEqual({ autoLinkTo: ['PRD-001'], reason: 'score' });
  });

  test('returns none when there are no mentions and no candidates', () => {
    expect(decideLinks([], [], triage)).toEqual({ autoLinkTo: [], reason: 'none' });
  });
});

describe('proposalTitle', () => {
  test('takes the first sentence of the first non-empty line', () => {
    expect(proposalTitle('Hello world. More context here.\nsecond line')).toBe('Hello world');
  });

  test('falls back to the whole line when there is no sentence terminator', () => {
    expect(proposalTitle('no periods here\nsecond line')).toBe('no periods here');
  });

  test('skips leading blank lines', () => {
    expect(proposalTitle('\n\nActual content.')).toBe('Actual content');
  });

  test('truncates to 80 chars when there is no early sentence terminator', () => {
    const long = 'x'.repeat(120);
    expect(proposalTitle(long)).toHaveLength(80);
  });
});

describe('triageText matched-terms gate', () => {
  test('does not auto-link a top score-only candidate sharing a single incidental term (e.g. a shared tag)', async () => {
    const detail: NodeDetail = { node: nodeView({ title: 'Graph Engine', body: 'Motor de grafos con detección.', tags: ['graph', 'mcp'] }), links: [] };
    const store = fakeStore({
      search: async () => [hit('PRD-001', 0.847), hit('FR-002', 0.076)],
      getNode: async () => detail,
    });

    const result = await triageText(store, fakeConfig({ autoLinkMinScore: 0.5, autoLinkMargin: 1.05, minMatchedTerms: 2 }), 'please add dark mode mobile graph');

    expect(result.reason).toBe('none');
    expect(result.autoLinkTo).toEqual([]);
    expect(result.proposal).not.toBeNull();
  });

  test('auto-links a top score-only candidate sharing at least minMatchedTerms distinct terms with the query', async () => {
    const detail: NodeDetail = {
      node: nodeView({ title: 'Graph Engine', body: 'Motor de grafos con desincronización y soporte MCP.', tags: ['graph', 'mcp'] }),
      links: [],
    };
    const store = fakeStore({
      search: async () => [hit('PRD-001', 0.9)],
      getNode: async () => detail,
    });

    const result = await triageText(
      store,
      fakeConfig({ autoLinkMinScore: 0.5, autoLinkMargin: 1.05, minMatchedTerms: 2 }),
      'necesito alertas de desincronización con soporte mcp',
    );

    expect(result.reason).toBe('score');
    expect(result.autoLinkTo).toEqual(['PRD-001']);
    expect(result.proposal).toBeNull();
  });

  test('explicit mentions bypass the matched-terms gate entirely', async () => {
    const detail: NodeDetail = { node: nodeView({ label: 'Feature', title: 'unrelated', body: 'nothing shared' }), links: [] };
    const store = fakeStore({
      search: async () => [],
      getNode: async () => detail,
    });

    const result = await triageText(store, fakeConfig({ minMatchedTerms: 2 }), 'See PRD-001 for details');

    expect(result.reason).toBe('mention');
    expect(result.autoLinkTo).toEqual(['PRD-001']);
  });
});
