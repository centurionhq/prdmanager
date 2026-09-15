import { describe, expect, test } from 'vitest';
import { createDocumentYDoc, InvalidDocumentRootError } from '../../src/schema.js';
import { applyProjection, projectDoc, type DocProjection } from '../../src/projection.js';

describe('projectDoc', () => {
  test('projects an empty document', () => {
    const ydoc = createDocumentYDoc();
    expect(projectDoc(ydoc)).toEqual({ title: '', fields: {}, body: '' });
  });

  test('projects frontmatter fields and body text', () => {
    const ydoc = createDocumentYDoc();
    ydoc.transact(() => {
      const fm = ydoc.getMap('fm');
      fm.set('title', 'My PRD');
      fm.set('tags', ['a', 'b']);
      ydoc.getText('body').insert(0, '# Body\n\nhello');
    });

    expect(projectDoc(ydoc)).toEqual({
      title: 'My PRD',
      fields: { title: 'My PRD', tags: ['a', 'b'] },
      body: '# Body\n\nhello',
    });
  });

  test('title defaults to empty string when the fm field is missing or not a string', () => {
    const ydoc = createDocumentYDoc();
    ydoc.getMap('fm').set('title', 42);
    expect(projectDoc(ydoc).title).toBe('');
  });
});

describe('applyProjection', () => {
  test('round-trips through projectDoc', () => {
    const ydoc = createDocumentYDoc();
    const projection: DocProjection = { title: 'Hello', fields: { title: 'Hello', tags: ['x'] }, body: 'body text' };
    applyProjection(ydoc, projection);
    expect(projectDoc(ydoc)).toEqual(projection);
  });

  test('replaces prior fm/body contents rather than merging', () => {
    const ydoc = createDocumentYDoc();
    applyProjection(ydoc, { title: 'First', fields: { title: 'First', extra: 'keep-me' }, body: 'first body' });
    applyProjection(ydoc, { title: 'Second', fields: { title: 'Second' }, body: 'second body' });
    expect(projectDoc(ydoc)).toEqual({ title: 'Second', fields: { title: 'Second' }, body: 'second body' });
  });

  test('tags the transaction with the given origin', () => {
    const ydoc = createDocumentYDoc();
    const origins: unknown[] = [];
    ydoc.on('afterTransaction', (tx) => origins.push(tx.origin));
    applyProjection(ydoc, { title: 't', fields: { title: 't' }, body: 'b' }, 'system:import');
    expect(origins).toContain('system:import');
  });

  test('rejects a projection field that is not a valid frontmatter value', () => {
    const ydoc = createDocumentYDoc();
    expect(() =>
      applyProjection(ydoc, { title: 't', fields: { title: 't', bad: { nested: true } as never }, body: 'b' }),
    ).toThrow(InvalidDocumentRootError);
  });
});
