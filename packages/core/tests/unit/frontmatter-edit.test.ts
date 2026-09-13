import matter from 'gray-matter';
import { describe, expect, test } from 'vitest';
import { renameFrontmatterKey, setFrontmatterFields } from '../../src/parser/frontmatter-edit.js';

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

  test('replaces a key written with spaces before the colon', () => {
    const src = `---\nid: WO-001\nstatus : todo\n---\nbody`;
    const out = setFrontmatterFields(src, { status: 'done' });
    expect(matter(out, {}).data.status).toBe('done');
    expect(out.match(/^status/gm)).toHaveLength(1);
  });

  test('replaces a double-quoted key', () => {
    const src = `---\nid: WO-001\n"status": todo\n---\nbody`;
    const out = setFrontmatterFields(src, { status: 'done' });
    expect(matter(out, {}).data.status).toBe('done');
    expect(out).not.toContain('"status": todo');
  });

  test('replaces a single-quoted key', () => {
    const src = `---\nid: WO-001\n'status': todo\n---\nbody`;
    const out = setFrontmatterFields(src, { status: 'done' });
    expect(matter(out, {}).data.status).toBe('done');
    expect(out).not.toContain("'status': todo");
  });

  test('replaces a block list containing a blank line between items', () => {
    const src = `---\nid: FB-001\ninforms:\n  - PRD-001\n\n  - PRD-002\nsource: email\n---\nbody`;
    const out = setFrontmatterFields(src, { informs: ['FR-001'] });
    const parsed = matter(out, {});
    expect(parsed.data.informs).toEqual(['FR-001']);
    expect(parsed.data.source).toBe('email');
    expect(out).toContain('informs: ["FR-001"]');
  });

  test('replaces a block list containing a comment line', () => {
    const src = `---\nid: FB-001\ninforms:\n  - PRD-001\n  # note\n  - PRD-002\nsource: email\n---\nbody`;
    const out = setFrontmatterFields(src, { informs: ['FR-001'] });
    const parsed = matter(out, {});
    expect(parsed.data.informs).toEqual(['FR-001']);
    expect(parsed.data.source).toBe('email');
    expect(out).not.toContain('# note');
  });

  test('does not treat a key sharing a prefix as the target key', () => {
    const src = `---\nid: WO-001\nstatus_note: keep me\nstatus: todo\n---\nbody`;
    const out = setFrontmatterFields(src, { status: 'done' });
    const parsed = matter(out, {});
    expect(parsed.data.status).toBe('done');
    expect(parsed.data.status_note).toBe('keep me');
    expect(out).toContain('status_note: keep me');
  });

  test('replaces a folded multi-line scalar value', () => {
    const src = `---\nid: WO-001\ndescription: >\n  line one\n  line two\nstatus: todo\n---\nbody`;
    const out = setFrontmatterFields(src, { description: 'short' });
    const parsed = matter(out, {});
    expect(parsed.data.description).toBe('short');
    expect(parsed.data.status).toBe('todo');
    expect(out).not.toContain('line one');
  });

  test('replaces a literal multi-line scalar value', () => {
    const src = `---\nid: WO-001\ndescription: |\n  line one\n  line two\nstatus: todo\n---\nbody`;
    const out = setFrontmatterFields(src, { description: 'short' });
    const parsed = matter(out, {});
    expect(parsed.data.description).toBe('short');
    expect(parsed.data.status).toBe('todo');
  });

  test('handles CRLF input', () => {
    const src = '---\r\nid: WO-001\r\nstatus: todo\r\n---\r\nbody';
    const out = setFrontmatterFields(src, { status: 'done' });
    expect(matter(out, {}).data.status).toBe('done');
  });

  test('handles frontmatter ending at EOF without a trailing newline', () => {
    const src = `---\nid: WO-001\nstatus: todo\n---`;
    const out = setFrontmatterFields(src, { status: 'done' });
    expect(matter(out, {}).data.status).toBe('done');
  });

  test('preserves trailing blank lines before the next top-level key', () => {
    const src = `---\nid: WO-001\nstatus: todo\n\ntitle: "Tarea"\n---\nbody`;
    const out = setFrontmatterFields(src, { status: 'done' });
    const parsed = matter(out, {});
    expect(parsed.data.status).toBe('done');
    expect(parsed.data.title).toBe('Tarea');
    expect(out).toContain('status: "done"\n\ntitle: "Tarea"');
  });

  test('does not confuse a quoted value containing "---" with the closing delimiter', () => {
    const src = `---\nid: WO-001\ntitle: "before --- after"\nstatus: todo\n---\nbody`;
    const out = setFrontmatterFields(src, { status: 'done' });
    const parsed = matter(out, {});
    expect(parsed.data.status).toBe('done');
    expect(parsed.data.title).toBe('before --- after');
    expect(parsed.content.trim()).toBe('body');
  });
});

describe('renameFrontmatterKey', () => {
  test('renames a top-level key, preserving its value formatting exactly', () => {
    const src = `---\nid: SDD-001\ntype: SDD\ngoverns:\n  - src/a.ts\n  - src/b.ts\n---\nbody`;
    const out = renameFrontmatterKey(src, 'governs', 'impacts_paths');
    expect(out).toBe(`---\nid: SDD-001\ntype: SDD\nimpacts_paths:\n  - src/a.ts\n  - src/b.ts\n---\nbody`);
    expect(matter(out, {}).data.impacts_paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('is a no-op when the old key is absent', () => {
    const src = `---\nid: SDD-001\ntype: SDD\nimpacts_paths: ["src/a.ts"]\n---\nbody`;
    expect(renameFrontmatterKey(src, 'governs', 'impacts_paths')).toBe(src);
  });

  test('renames a double-quoted key', () => {
    const src = `---\nid: SDD-001\n"governs": ["src/a.ts"]\n---\nbody`;
    const out = renameFrontmatterKey(src, 'governs', 'impacts_paths');
    expect(out).toContain('"impacts_paths": ["src/a.ts"]');
  });

  test('renames a single-quoted key', () => {
    const src = `---\nid: SDD-001\n'governs': ["src/a.ts"]\n---\nbody`;
    const out = renameFrontmatterKey(src, 'governs', 'impacts_paths');
    expect(out).toContain("'impacts_paths': [\"src/a.ts\"]");
  });

  test('does not touch a key sharing a prefix', () => {
    const src = `---\nid: WO-001\nstatus_note: keep me\nstatus: todo\n---\nbody`;
    const out = renameFrontmatterKey(src, 'status', 'state');
    expect(out).toContain('status_note: keep me');
    expect(out).toContain('state: todo');
  });

  test('throws when the document has no frontmatter', () => {
    expect(() => renameFrontmatterKey('# nope', 'governs', 'impacts_paths')).toThrow(/frontmatter/i);
  });
});
