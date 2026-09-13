import { describe, expect, test } from 'vitest';
import { setFrontmatterFields } from '../../src/parser/frontmatter-edit.js';

const doc = `---
id: WO-001
type: WO
title: "Tarea"
status: todo
implements: ["SDD-001"]
---

## Objetivo
status: todo (this line is body, not frontmatter)
`;

describe('setFrontmatterFields', () => {
  test('replaces an existing scalar without touching other lines or the body', () => {
    const out = setFrontmatterFields(doc, { status: 'done' });
    expect(out).toContain('status: "done"');
    expect(out).toContain('title: "Tarea"');
    expect(out).toContain('status: todo (this line is body, not frontmatter)');
    const front = out.split('---')[1] ?? '';
    expect(front.match(/^status:/gm)).toHaveLength(1);
  });

  test('appends missing fields before the closing delimiter', () => {
    const out = setFrontmatterFields(doc, { assigned_to: 'agent:claude', resolved_by: ['abc123'] });
    const front = out.split('---')[1] ?? '';
    expect(front).toContain('assigned_to: "agent:claude"');
    expect(front).toContain('resolved_by: ["abc123"]');
  });

  test('replaces block-style YAML lists entirely', () => {
    const blockList = `---\nid: FB-001\ntype: FB\ninforms:\n  - PRD-001\n  - PRD-002\nsource: email\n---\nbody`;
    const out = setFrontmatterFields(blockList, { informs: ['FR-001'] });
    expect(out).toBe(`---\nid: FB-001\ntype: FB\ninforms: ["FR-001"]\nsource: email\n---\nbody`);
  });

  test('serializes record values as inline JSON maps', () => {
    const out = setFrontmatterFields(doc, { blueprint_hashes: { 'SDD-001': 'abc' } });
    expect(out).toContain('blueprint_hashes: {"SDD-001":"abc"}');
  });

  test('throws when the document has no frontmatter', () => {
    expect(() => setFrontmatterFields('# nope', { status: 'done' })).toThrow(/frontmatter/i);
  });
});
