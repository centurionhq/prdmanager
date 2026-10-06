import { describe, expect, test } from 'vitest';
import { parseDocument } from '../../src/parser/frontmatter.js';
import { deriveImpactPaths, planWorkOrders } from '../../src/workorders/generator.js';
import { doc } from '@prdm/testkit';

const NOW = new Date('2026-09-12T00:00:00Z');
const OPTIONS = { docsDir: 'docs', now: NOW };

function blueprint(body: string, extra = ''): ReturnType<typeof doc> {
  return doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/sync/**"]\ntags: ["graph"]\n${extra}`, body);
}

describe('planWorkOrders', () => {
  test('creates a pending work order for both [ ] and [x] tasks', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Implementar hashing de código\n- [x] Leer commits de git\n');
    const planned = planWorkOrders(bp, [], OPTIONS);

    expect(planned).toHaveLength(2);
    expect(planned[0]).toMatchObject({ id: 'WO-001', status: 'pending', title: 'Implementar hashing de código' });
    expect(planned[1]).toMatchObject({ id: 'WO-002', status: 'pending', title: 'Leer commits de git' });
    expect(planned[0]?.path).toBe('docs/work-orders/WO-001-implementar-hashing-de-codigo.md');
  });

  test('accepts the English "## Tasks" heading', () => {
    const bp = blueprint('design\n\n## Tasks\n- [ ] Do the thing\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ status: 'pending', title: 'Do the thing' });
  });

  test('is case-insensitive for the done marker, but still plans a pending work order', () => {
    const bp = blueprint('design\n\n## Tareas\n- [X] Ya hecho\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned[0]?.status).toBe('pending');
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
    expect(second[0]).toMatchObject({ id: 'WO-002', title: 'Leer commits de git', status: 'pending' });
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

  test('rendered content parses, inherits impacts_paths/tags/implements, and never records blueprint_hashes', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Pendiente\n- [x] Leer commits de git\n');
    const planned = planWorkOrders(bp, [], OPTIONS);

    for (const plan of planned) {
      const parsed = parseDocument(plan.content, plan.path);
      if (!parsed?.ok) throw new Error('expected a valid document');
      if (parsed.doc.frontmatter.type !== 'WO') throw new Error('expected a work order');

      expect(parsed.doc.frontmatter.status).toBe('pending');
      expect(parsed.doc.frontmatter.implements).toEqual(['SDD-001']);
      expect(parsed.doc.frontmatter.impacts_paths).toEqual(['src/sync/**']);
      expect(parsed.doc.frontmatter.tags).toEqual(['graph']);
      expect(parsed.doc.frontmatter.blueprint_hashes).toEqual({});
    }

    const first = parseDocument(planned[0]!.content, planned[0]!.path);
    if (!first?.ok) throw new Error('expected a valid document');
    expect(first.doc.node.body).toContain('## Objetivo');
    expect(first.doc.node.body).toContain('## Contexto');
    expect(first.doc.node.body).toContain('PRD-001');
    expect(first.doc.node.body).toContain('## Criterios de aceptación');
    expect(first.doc.node.body).toContain(`Refs: ${planned[0]!.id}`);
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

const MULTI_PATHS = ['packages/core/src/a.ts', 'packages/app/src/b.tsx', 'packages/server/src/c.ts', 'packages/app/tests/d.test.tsx', 'packages/core/tests/e.test.ts'];
const MULTI_EXTRA = `impacts_paths: ${JSON.stringify(MULTI_PATHS)}`;

function multiBlueprint(tasks: string): ReturnType<typeof doc> {
  return doc(`id: SDD-002\ntype: SDD\ntitle: Multi\narchitects: [PRD-001]\n${MULTI_EXTRA}\ntags: ["graph"]\n`, `design\n\n## Tareas\n${tasks}`);
}

function parsedOf(plan: { content: string; path: string }) {
  const parsed = parseDocument(plan.content, plan.path);
  if (!parsed?.ok || parsed.doc.frontmatter.type !== 'WO') throw new Error('expected a valid work order');
  return { fm: parsed.doc.frontmatter, body: parsed.doc.node.body };
}

describe('planWorkOrders — impacts_paths por tarea (SDD-068)', () => {
  test('five tasks of different domains get five distinct, disjoint impacts_paths', () => {
    const bp = multiBlueprint(
      [
        '- [ ] Ajustar a.ts en core',
        '- [ ] Pintar b.tsx en la app',
        '- [ ] Exponer c.ts en el server',
        '- [ ] Cubrir d.test.tsx de la app',
        '- [ ] Cubrir e.test.ts de core',
      ].join('\n'),
    );
    const planned = planWorkOrders(bp, [], OPTIONS).map((p) => parsedOf(p).fm.impacts_paths);
    expect(planned).toEqual(MULTI_PATHS.map((p) => [p]));
  });

  test('keeps blueprint order inside a WO that names several files', () => {
    const bp = multiBlueprint('- [ ] Tocar e.test.ts y a.ts a la vez\n');
    const [plan] = planWorkOrders(bp, [], OPTIONS);
    expect(parsedOf(plan!).fm.impacts_paths).toEqual(['packages/core/src/a.ts', 'packages/core/tests/e.test.ts']);
    expect(parsedOf(plan!).body).toContain('paths: packages/core/src/a.ts, packages/core/tests/e.test.ts');
  });

  test('a task naming no file inherits the blueprint list and declares the fallback in the body', () => {
    const bp = multiBlueprint('- [ ] Revisar la documentación general\n');
    const [plan] = planWorkOrders(bp, [], OPTIONS);
    const { fm, body } = parsedOf(plan!);
    expect(fm.impacts_paths).toEqual(MULTI_PATHS);
    expect(body).toContain('paths: heredados del blueprint (el ítem no nombra archivos)');
  });

  test('a `paths:` line under an item wins over the textual match', () => {
    const bp = multiBlueprint('- [ ] Tocar a.ts\n  paths: x/one.ts, x/two.ts\n- [ ] Otro\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned).toHaveLength(2);
    const { fm, body } = parsedOf(planned[0]!);
    expect(fm.impacts_paths).toEqual(['x/one.ts', 'x/two.ts']);
    expect(body).toContain('paths: x/one.ts, x/two.ts');
    expect(body).not.toContain('packages/core/src/a.ts');
    expect(planned[0]?.title).toBe('Tocar a.ts');
  });

  test('a `paths:` line wins when the item text has no textual match either', () => {
    const bp = multiBlueprint('- [ ] Revisar algo\n  paths: y.ts\n');
    const [plan] = planWorkOrders(bp, [], OPTIONS);
    expect(parsedOf(plan!).fm.impacts_paths).toEqual(['y.ts']);
  });

  test('source_task ignores the paths override (idempotent when the override is added later)', () => {
    const plain = planWorkOrders(multiBlueprint('- [ ] Tocar a.ts\n'), [], OPTIONS)[0]!;
    const withOverride = planWorkOrders(multiBlueprint('- [ ] Tocar a.ts\n  paths: x.ts\n'), [], OPTIONS)[0]!;
    expect(parsedOf(withOverride).fm.source_task).toBe(parsedOf(plain).fm.source_task);
  });

  test('a glob path the item does not name is inherited', () => {
    const bp = blueprint('design\n\n## Tareas\n- [ ] Leer commits de git\n');
    const [plan] = planWorkOrders(bp, [], OPTIONS);
    expect(parsedOf(plan!).fm.impacts_paths).toEqual(['src/sync/**']);
  });
});

describe('deriveImpactPaths', () => {
  const BP = ['packages/core/src/workorders/generator.ts', 'packages/core/src/index.ts', 'src/sync/**'];

  test('override wins and is not validated against the blueprint', () => {
    expect(deriveImpactPaths('toca generator.ts', ['z.ts'], BP)).toEqual({ paths: ['z.ts'], source: 'override' });
  });

  test('an empty override is ignored', () => {
    expect(deriveImpactPaths('toca generator.ts', [], BP).source).toBe('match');
  });

  test('matches a basename without extension as a delimited token', () => {
    expect(deriveImpactPaths('Refactorizar el generator', undefined, BP)).toEqual({
      paths: ['packages/core/src/workorders/generator.ts'],
      source: 'match',
    });
  });

  test('matches the full path, case-insensitively', () => {
    expect(deriveImpactPaths('Editar PACKAGES/core/src/index.ts', undefined, BP).paths).toEqual(['packages/core/src/index.ts']);
  });

  test('does not match a token embedded in a longer word (index inside indexar)', () => {
    expect(deriveImpactPaths('Indexar los documentos', undefined, BP)).toEqual({ paths: BP, source: 'inherited' });
  });

  test('a glob only matches when the item contains the whole glob', () => {
    expect(deriveImpactPaths('Cambiar sync', undefined, BP).source).toBe('inherited');
    expect(deriveImpactPaths('Cubrir src/sync/** con tests', undefined, BP)).toEqual({ paths: ['src/sync/**'], source: 'match' });
  });

  test('normalizes a leading ./ on blueprint paths', () => {
    expect(deriveImpactPaths('tocar a.ts', undefined, ['./src/a.ts'])).toEqual({ paths: ['src/a.ts'], source: 'match' });
  });
});

describe('extractTasks', () => {
  test('a `paths:` line is not a task and does not count as one', () => {
    const bp = multiBlueprint('- [ ] Uno\n  paths: a.ts\n- [ ] Dos\n');
    const planned = planWorkOrders(bp, [], OPTIONS);
    expect(planned.map((p) => p.title)).toEqual(['Uno', 'Dos']);
  });
});
