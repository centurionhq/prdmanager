import { describe, expect, test } from 'vitest';
import { parseDocument } from '../../src/parser/frontmatter.js';

const prd = `---
id: PRD-001
type: PRD
title: "Graph Engine"
status: draft
created_at: 2026-09-12
implements: ["MRD-001"]
tags: ["mcp", "graph"]
---

## Visión
Motor de grafos.
`;

describe('parseDocument', () => {
  test('returns null for markdown without graph frontmatter', () => {
    expect(parseDocument('# README\nhello', 'README.md')).toBeNull();
    expect(parseDocument('---\ntitle: x\n---\nbody', 'x.md')).toBeNull();
  });

  test('parses a PRD into a Feature node with EVOLVES_FROM edge', () => {
    const result = parseDocument(prd, 'PRD-001.md');
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    const { doc } = result;
    expect(doc.node).toMatchObject({
      id: 'PRD-001',
      label: 'Feature',
      kind: 'PRD',
      title: 'Graph Engine',
      status: 'draft',
      sourcePath: 'PRD-001.md',
      createdAt: '2026-09-12',
      tags: ['mcp', 'graph'],
    });
    expect(doc.node.body).toContain('Motor de grafos.');
    expect(doc.edges).toEqual([{ from: 'PRD-001', to: 'MRD-001', type: 'EVOLVES_FROM' }]);
  });

  test('parses a Blueprint with architects and governs', () => {
    const content = `---
id: SDD-001
type: SDD
title: Arquitectura
architects: [PRD-001]
governs: ["src/sync/**", "src/graph/store.ts#Neo4jGraphStore"]
---
## Tareas
- [ ] Hacer algo
`;
    const result = parseDocument(content, 'docs/blueprints/SDD-001.md');
    if (!result?.ok) throw new Error('expected ok');
    expect(result.doc.node.label).toBe('Blueprint');
    expect(result.doc.node.status).toBe('active');
    expect(result.doc.governs).toEqual(['src/sync/**', 'src/graph/store.ts#Neo4jGraphStore']);
    expect(result.doc.edges).toEqual([{ from: 'SDD-001', to: 'PRD-001', type: 'ARCHITECTS' }]);
  });

  test('parses a Work Order with assignment and implements', () => {
    const content = `---
id: WO-003
type: WO
title: Implementar parser
status: in_progress
implements: [SDD-001]
assigned_to: agent:claude
claimed_at: "2026-09-12T10:00:00.000Z"
---
Objetivo
`;
    const result = parseDocument(content, 'docs/work-orders/WO-003.md');
    if (!result?.ok) throw new Error('expected ok');
    expect(result.doc.node.label).toBe('WorkOrder');
    expect(result.doc.node.props).toMatchObject({ assigned_to: 'agent:claude', claimed_at: '2026-09-12T10:00:00.000Z' });
    expect(result.doc.edges).toEqual([{ from: 'WO-003', to: 'SDD-001', type: 'IMPLEMENTS' }]);
    expect(result.doc.actor).toEqual({ id: 'agent:claude', kind: 'ai_agent' });
  });

  test('parses Artifact and Feedback context edges', () => {
    const art = parseDocument(`---\nid: ART-001\ntype: ART\ntitle: Call\nsource: meeting\nprovides_context_for: [PRD-001]\n---\ntranscript`, 'a.md');
    const fb = parseDocument(`---\nid: FB-001\ntype: FB\ntitle: Queja\nsource: email\ninforms: [PRD-001]\n---\ntexto`, 'f.md');
    if (!art?.ok || !fb?.ok) throw new Error('expected ok');
    expect(art.doc.edges).toEqual([{ from: 'ART-001', to: 'PRD-001', type: 'PROVIDES_CONTEXT_FOR' }]);
    expect(fb.doc.edges).toEqual([{ from: 'FB-001', to: 'PRD-001', type: 'INFORMS' }]);
    expect(fb.doc.node.label).toBe('Feedback');
  });

  test('rejects id prefix that does not match type', () => {
    const result = parseDocument(`---\nid: PRD-001\ntype: SDD\ntitle: x\narchitects: [PRD-002]\n---\n`, 'x.md');
    expect(result).toMatchObject({ ok: false });
    if (result?.ok === false) expect(result.error).toMatch(/prefix/i);
  });

  test('rejects work order without implements', () => {
    const result = parseDocument(`---\nid: WO-001\ntype: WO\ntitle: x\n---\n`, 'x.md');
    expect(result).toMatchObject({ ok: false });
  });

  test('rejects malformed ids in links', () => {
    const result = parseDocument(`---\nid: FB-001\ntype: FB\ntitle: x\nsource: email\ninforms: ["../etc/passwd"]\n---\n`, 'x.md');
    expect(result).toMatchObject({ ok: false });
  });

  test('content hash ignores volatile fields but tracks body and links', () => {
    const base = `---\nid: WO-001\ntype: WO\ntitle: x\nstatus: todo\nimplements: [SDD-001]\n---\nbody\n`;
    const statusChanged = base.replace('status: todo', 'status: done');
    const bodyChanged = base.replace('body', 'other body');
    const h = (c: string) => {
      const r = parseDocument(c, 'x.md');
      if (!r?.ok) throw new Error('expected ok');
      return r.doc.node.contentHash;
    };
    expect(h(base)).toBe(h(statusChanged));
    expect(h(base)).not.toBe(h(bodyChanged));
    expect(h(base.replace('\n', '\r\n'))).toBe(h(base));
  });
});
