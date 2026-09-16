import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../src/api/api-client-error.js';
import { errorMessage } from '../../src/api/error-message.js';

describe('errorMessage', () => {
  it('returns a fixed Spanish message for a rate_limited error, regardless of the server text', () => {
    const error = new ApiClientError(429, 'rate_limited', 'too many requests');
    expect(errorMessage(error)).toBe('Demasiados intentos. Probá de nuevo en un momento.');
  });

  it('returns a fixed Spanish message for a not_found error, regardless of the server text', () => {
    const error = new ApiClientError(404, 'not_found', 'no row');
    expect(errorMessage(error)).toBe('No encontramos lo que buscabas.');
  });

  it('passes through the server message for every other code', () => {
    const error = new ApiClientError(409, 'conflict', 'ya existe un proyecto con ese slug');
    expect(errorMessage(error)).toBe('ya existe un proyecto con ese slug');
  });

  it('falls back to a generic message for a non-ApiClientError', () => {
    expect(errorMessage(new Error('network down'))).toBe('Ocurrió un error inesperado. Probá de nuevo.');
    expect(errorMessage('not even an error')).toBe('Ocurrió un error inesperado. Probá de nuevo.');
  });
});
