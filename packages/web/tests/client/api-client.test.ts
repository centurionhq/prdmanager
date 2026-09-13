import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, getNode, getProject } from '../../src/client/api/client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api/client request handling', () => {
  it('parses a successful JSON response', async () => {
    const summary = { id: 'prj_1', name: 'repo', folders: {}, lifecycle: {}, counts: {} };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, summary)));

    await expect(getProject()).resolves.toEqual(summary);
  });

  it('throws ApiClientError with the parsed code/message on a 404 ApiError body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: { code: 'not_found', message: 'FR-001 not found' } })),
    );

    await expect(getNode('FR-001')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 404,
      code: 'not_found',
      message: 'FR-001 not found',
    });
  });

  it('throws ApiClientError with code "unknown" when a non-2xx body is not ApiError-shaped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })),
    );

    const error = await getProject().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(502);
    expect((error as ApiClientError).code).toBe('unknown');
  });

  it('throws ApiClientError on a malformed (non-JSON) 200 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));

    const error = await getProject().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe('unknown');
  });

  it('throws ApiClientError on an empty 200 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));

    await expect(getProject()).rejects.toBeInstanceOf(ApiClientError);
  });
});
