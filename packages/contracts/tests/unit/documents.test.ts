import { describe, expect, it } from 'vitest';
import { createDocumentFieldsSchema, createDocumentInputSchema } from '../../src/index.js';

describe('createDocumentInputSchema (SDD-052)', () => {
  it('keeps accepting the bare { kind, title } every existing caller sends', () => {
    expect(createDocumentInputSchema.safeParse({ kind: 'PRD', title: 'Aviso de orden atrasada' }).success).toBe(true);
  });

  it('accepts justified_by as a list of document ids, business cases included', () => {
    const parsed = createDocumentInputSchema.safeParse({ kind: 'PRD', title: 'Aviso', fields: { justified_by: ['BC-013'] } });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.fields).toEqual({ justified_by: ['BC-013'] });
  });

  it.each(['status', 'id', 'type', 'closed_at', 'implements', 'tags', 'architects'])('refuses %s: justified_by is the only key a browser may seed', (key) => {
    expect(createDocumentInputSchema.safeParse({ kind: 'PRD', title: 'Aviso', fields: { [key]: 'x' } }).success).toBe(false);
  });

  it('refuses a mix of the allowed key and a forbidden one, rather than silently dropping the forbidden one', () => {
    expect(createDocumentInputSchema.safeParse({ kind: 'PRD', title: 'Aviso', fields: { justified_by: ['BC-013'], status: 'approved' } }).success).toBe(false);
  });

  it.each([['not-an-id'], ['bc-013'], ['BC-1'], ['BC-013\nstatus: approved'], ['']])('refuses %j as a justified_by entry', (entry) => {
    expect(createDocumentFieldsSchema.safeParse({ justified_by: [entry] }).success).toBe(false);
  });

  it('refuses justified_by that is not a list, and one that is empty or unbounded', () => {
    expect(createDocumentFieldsSchema.safeParse({ justified_by: 'BC-013' }).success).toBe(false);
    expect(createDocumentFieldsSchema.safeParse({ justified_by: [] }).success).toBe(false);
    expect(createDocumentFieldsSchema.safeParse({ justified_by: Array.from({ length: 21 }, (_, i) => `BC-${String(i + 1).padStart(3, '0')}`) }).success).toBe(false);
  });
});
