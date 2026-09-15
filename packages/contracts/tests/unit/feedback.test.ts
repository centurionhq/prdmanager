/**
 * Feedback inbox DTO validation (SDD-012, WO-327): the FB/ART inbox item shown to a triager, the
 * submit-feedback payload (mirrors `@prdm/core`'s `submitFeedback` input) and a triage candidate.
 */
import { describe, expect, test } from 'vitest';
import { candidateSchema, inboxItemSchema, submitFeedbackInputSchema } from '../../src/feedback.js';

describe('inboxItemSchema', () => {
  const valid = {
    id: 'FB-001',
    kind: 'FB' as const,
    title: 'El cliente pidió alertas',
    body: 'Texto libre del feedback.',
    status: 'new',
    source: 'call',
    links: ['PRD-001'],
    receivedAt: '2026-09-01T00:00:00.000Z',
  };

  test('accepts a valid feedback item', () => {
    expect(inboxItemSchema.parse(valid)).toEqual(valid);
  });

  test('accepts an artifact item', () => {
    expect(inboxItemSchema.parse({ ...valid, id: 'ART-001', kind: 'ART' }).kind).toBe('ART');
  });

  test('rejects an invalid kind', () => {
    expect(() => inboxItemSchema.parse({ ...valid, kind: 'FR' })).toThrow();
  });
});

describe('submitFeedbackInputSchema', () => {
  test('accepts the minimal required fields', () => {
    const parsed = submitFeedbackInputSchema.parse({ text: 'El cliente pidió alertas', source: 'call' });
    expect(parsed.title).toBeUndefined();
  });

  test('accepts optional title/customer', () => {
    const parsed = submitFeedbackInputSchema.parse({ text: 'texto', source: 'call', title: 'Título', customer: 'Acme' });
    expect(parsed.customer).toBe('Acme');
  });

  test('rejects empty text', () => {
    expect(() => submitFeedbackInputSchema.parse({ text: '', source: 'call' })).toThrow();
  });
});

describe('candidateSchema', () => {
  test('accepts a scored candidate', () => {
    expect(candidateSchema.parse({ featureId: 'PRD-001', score: 0.82, reason: 'score' })).toEqual({ featureId: 'PRD-001', score: 0.82, reason: 'score' });
  });

  test('rejects an invalid reason', () => {
    expect(() => candidateSchema.parse({ featureId: 'PRD-001', score: 0.82, reason: 'bogus' })).toThrow();
  });
});
