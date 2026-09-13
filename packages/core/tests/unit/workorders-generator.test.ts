import { describe, expect, test } from 'vitest';
import { parseDocument } from '../../src/parser/frontmatter.js';
import { planWorkOrders } from '../../src/workorders/generator.js';
import { doc } from '@prdm/testkit';

const NOW = new Date('2026-09-12T00:00:00Z');
const OPTIONS = { docsDir: 'docs', now: NOW };

function blueprint(body: string, extra = ''): ReturnType<typeof doc> {
  return doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\ngoverns: ["src/sync/**"]\ntags: ["graph"]\n${extra}`, body);
}

describe('planWorkOrders', () => {
  test('creates a todo work order for [ ] and a done one for [x]', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Implementar hashing de código\n- [x] Leer commits de git\n');
    const planned = planWorkOrders(bp, [], OPTIONS);

    expect(planned).toHaveLength(2);
    expect(planned[0]).toMatchObject({ id: 'WO-001', status: 'todo', title: 'Implementar hashing de código' });
    expect(planned[1]).toMatchObject({ id: 'WO-002', status: 'done', title: 'Leer commits de git' });
    expect(planned[0]?.path).toBe('docs/work-orders/WO-001-implementar-hashing-de-codigo.md');
  });

  test('accepts the English "## Tasks" heading', () => {
    const bp = blueprint('design\n\n## Tasks\n- [ ] Do the thing\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ status: 'todo', title: 'Do the thing' });
  });

  test('is case-insensitive for the done marker', () => {
    const bp = blueprint('design\n\n## Tareas\n- [X] Ya hecho\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned[0]?.status).toBe('done');
  });

  test('stops parsing at the next heading', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Uno\n\n## Otra sección\n- [ ] No debería contarse\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.title).toBe('Uno');
  });

  test('returns an empty array when there is no Tareas/Tasks section', () => {
    const bp = blueprint('solo diseño, sin tareas');
    expect(planWorkOrders(bp, [], OPTIONS)).toEqual([]);
  });

  test('throws when the document is not a blueprint', () => {
    const notBlueprint = doc('id: PRD-001\ntype: PRD\ntitle: x');
    expect(() => planWorkOrders(notBlueprint, [], OPTIONS)).toThrow(/not a blueprint/i);
  });

  test('skips tasks already materialized as a work order via source_task, and id sequencing continues', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Implementar hashing de código\n- [x] Leer commits de git\n');
    const first = planWorkOrders(bp, [], OPTIONS);
    const alreadyGenerated = parseDocument(first[0]!.content, first[0]!.path);
    if (!alreadyGenerated?.ok) throw new Error('expected a valid planned work order');

    const second = planWorkOrders(bp, [alreadyGenerated.doc], OPTIONS);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: 'WO-002', title: 'Leer commits de git', status: 'done' });
  });

  test('a second run over the same blueprint plans nothing once every task has a work order', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Uno\n- [x] Dos\n');
    const first = planWorkOrders(bp, [], OPTIONS);
    const existing = first.map((p) => {
      const parsed = parseDocument(p.content, p.path);
      if (!parsed?.ok) throw new Error('expected a valid planned work order');
      return parsed.doc;
    });
    expect(planWorkOrders(bp, existing, OPTIONS)).toEqual([]);
  });

  test('rendered content parses, inherits governs/tags/implements, and records blueprint_hashes for done tasks', () => {
    const bp = blueprint('design\n\n## Tareas\n- [x] Leer commits de git\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    const parsed = parseDocument(planned[0]!.content, planned[0]!.path);
    if (!parsed?.ok) throw new Error('expected a valid document');
    if (parsed.doc.frontmatter.type !== 'WO') throw new Error('expected a work order');

    expect(parsed.doc.frontmatter.implements).toEqual(['SDD-001']);
    expect(parsed.doc.frontmatter.governs).toEqual(['src/sync/**']);
    expect(parsed.doc.frontmatter.tags).toEqual(['graph']);
    expect(parsed.doc.frontmatter.blueprint_hashes).toEqual({ 'SDD-001': bp.node.contentHash });
    expect(parsed.doc.node.body).toContain('## Objetivo');
    expect(parsed.doc.node.body).toContain('## Contexto');
    expect(parsed.doc.node.body).toContain('PRD-001');
    expect(parsed.doc.node.body).toContain('## Criterios de aceptación');
    expect(parsed.doc.node.body).toContain(`Refs: ${planned[0]!.id}`);
  });

  test('does not record blueprint_hashes for todo tasks', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Pendiente\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    const parsed = parseDocument(planned[0]!.content, planned[0]!.path);
    if (!parsed?.ok) throw new Error('expected a valid document');
    if (parsed.doc.frontmatter.type !== 'WO') throw new Error('expected a work order');
    expect(parsed.doc.frontmatter.blueprint_hashes).toEqual({});
  });

  test('truncates long task titles to 300 characters', () => {
    const longTask = 'x'.repeat(400);
    const bp = blueprint(`design\n\n## Tareas\n- [ ] ${longTask}\n`);
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned[0]?.title).toHaveLength(300);
  });

  test('skips reserved ids (e.g. from a document that failed validation) when allocating new work order ids', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Uno\n- [ ] Dos\n');
    const planned = planWorkOrders(bp, [], { ...OPTIONS, reservedIds: ['WO-001'] });

    expect(planned.map((p) => p.id)).toEqual(['WO-002', 'WO-003']);
  });
});
