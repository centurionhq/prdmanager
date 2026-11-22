import { describe, expect, test } from 'vitest';
import { BRANCH, FULL_GRAPH, LIST_WORK_ORDERS, MERGE_COMMITS } from '../../src/graph/queries.js';
import type { SubgraphNode } from '../../src/graph/types.js';

describe('subgraph projection publishes Commit date and sha (SDD-120 D1)', () => {
  test('BRANCH projects date and sha on each node', () => {
    expect(BRANCH).toContain('date: n.date');
    expect(BRANCH).toContain('sha: n.sha');
  });

  test('FULL_GRAPH projects date and sha on each node', () => {
    expect(FULL_GRAPH).toContain('date: n.date');
    expect(FULL_GRAPH).toContain('sha: n.sha');
  });

  test('date and sha are not coalesced, so non-Commit nodes yield null', () => {
    for (const query of [BRANCH, FULL_GRAPH]) {
      expect(query).not.toContain('coalesce(n.date');
      expect(query).not.toContain('coalesce(n.sha');
    }
  });

  test('LIST_WORK_ORDERS keeps its landed-commit ordering and projection', () => {
    expect(LIST_WORK_ORDERS).toContain('ORDER BY c.date DESC, c.sha DESC LIMIT 1');
    expect(LIST_WORK_ORDERS).toContain('landed[0] AS landedCommitSha');
  });

  test('MERGE_COMMITS keeps the 7-hex commit ref format', () => {
    expect(MERGE_COMMITS).toContain(`'commit:' + substring(c.sha, 0, 7)`);
  });

  test('SubgraphNode treats date and sha as optional and nullable', () => {
    const without: SubgraphNode = { ref: 'a', label: 'Node', kind: null, title: 't', status: null };
    const withNulls: SubgraphNode = { ...without, date: null, sha: null };
    const withValues: SubgraphNode = { ...without, date: '2026-01-01', sha: 'abc1234' };
    expect([without, withNulls, withValues]).toHaveLength(3);
  });
});
