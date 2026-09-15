import { describe, expect, test } from 'vitest';
import { ERROR_CODES, errorEnvelope, errorEnvelopeSchema } from '../../src/error-envelope.js';

describe('errorEnvelopeSchema', () => {
  test('accepts every documented error code (SDD-006 §Arquitectura)', () => {
    for (const code of ERROR_CODES) {
      const envelope = errorEnvelope(code, 'something went wrong');
      expect(errorEnvelopeSchema.parse(envelope)).toEqual({ error: { code, message: 'something went wrong' } });
    }
  });

  test('rejects an unknown error code', () => {
    const result = errorEnvelopeSchema.safeParse({ error: { code: 'teapot', message: 'nope' } });
    expect(result.success).toBe(false);
  });

  test('rejects an empty message', () => {
    const result = errorEnvelopeSchema.safeParse({ error: { code: 'not_found', message: '' } });
    expect(result.success).toBe(false);
  });

  test('rejects a payload without the error wrapper', () => {
    const result = errorEnvelopeSchema.safeParse({ code: 'not_found', message: 'missing' });
    expect(result.success).toBe(false);
  });
});
