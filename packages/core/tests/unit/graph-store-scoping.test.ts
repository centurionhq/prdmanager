import neo4j from 'neo4j-driver';
import { describe, expect, test } from 'vitest';
import { buildScopedLuceneQuery } from '../../src/graph/lucene.js';
import { SCOPED_QUERIES } from '../../src/graph/queries.js';
import { Neo4jGraphStore } from '../../src/graph/store.js';

const VALID_PROJECT = { id: 'prj_0123456789abcdef', name: 'demo', root: '/tmp/demo' };

describe('scoped store: $projectId is never optional (ADR-002 D1)', () => {
  test('every Cypher string the scoped store can run is parameterized with $projectId', () => {
    expect(SCOPED_QUERIES.length).toBeGreaterThan(0);
    for (const query of SCOPED_QUERIES) {
      expect(query).toContain('$projectId');
    }
  });
});

describe('project id validation (ADR-002 D5/D6)', () => {
  test('Neo4jGraphStore rejects an invalid project id at construction', () => {
    const driver = neo4j.driver('bolt://127.0.0.1:1', neo4j.auth.basic('neo4j', 'x'));
    try {
      expect(() => new Neo4jGraphStore(driver, 'neo4j', { id: 'not-a-project-id', name: 'x', root: '/tmp' })).toThrow(/invalid project id/);
      expect(() => new Neo4jGraphStore(driver, 'neo4j', VALID_PROJECT)).not.toThrow();
    } finally {
      void driver.close();
    }
  });

  test('buildScopedLuceneQuery rejects an invalid project id before it reaches the Lucene query string', () => {
    expect(() => buildScopedLuceneQuery('graph', 'prj_bad')).toThrow(/invalid project id/);
    expect(() => buildScopedLuceneQuery('graph', "prj_0123456789abcdef\" OR 1=1")).toThrow(/invalid project id/);
  });

  test('buildScopedLuceneQuery quotes a valid project id as an exact phrase alongside the free-text terms', () => {
    expect(buildScopedLuceneQuery('dark mode', 'prj_0123456789abcdef')).toBe('+project_id:"prj_0123456789abcdef" +(dark OR mode)');
    expect(buildScopedLuceneQuery('the and el la', 'prj_0123456789abcdef')).toBeNull();
  });
});
