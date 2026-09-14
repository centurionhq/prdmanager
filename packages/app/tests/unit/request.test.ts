import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../src/api/api-client-error.js';
import { authRequest, request } from '../../src/api/request.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('request()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends credentials:"include" and never fetches a CSRF token for a GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { organizations: [] }));

    const result = await request<{ organizations: unknown[] }>('/api/app/organizations');

    expect(result).toEqual({ organizations: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(init.headers['x-csrf-token']).toBeUndefined();
  });

  it('fetches a fresh CSRF token before a mutating /api/app request and attaches it as a header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'csrf-abc' })); // GET /api/app/csrf-token
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { organizationId: 'org_1' })); // the real mutating call

    const result = await request<{ organizationId: string }>('/api/app/organizations/active', {
      method: 'POST',
      body: { organizationId: 'org_1' },
    });

    expect(result).toEqual({ organizationId: 'org_1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/app/csrf-token');
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe('/api/app/organizations/active');
    expect(init.headers['x-csrf-token']).toBe('csrf-abc');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ organizationId: 'org_1' }));
    expect(init.credentials).toBe('include');
  });

  it('maps a shared error envelope to a typed ApiClientError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: 'not_found', message: 'not found' } }));

    await expect(request('/api/app/organizations/nope/members')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'not found',
    });
    await expect(request('/api/app/organizations/nope/members')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('falls back to code "unknown" for a non-envelope error body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));

    await expect(request('/api/app/organizations')).rejects.toMatchObject({ status: 502, code: 'unknown' });
  });

  it('throws when the CSRF token endpoint itself fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'internal_error', message: 'boom' } }));

    await expect(request('/api/app/tokens', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'unknown' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('authRequest()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never fetches a CSRF token, even for a mutating call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1', email: 'a@example.test', name: 'A' } }));

    await authRequest('/api/auth/sign-in/email', { method: 'POST', body: { email: 'a@example.test', password: 'x' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['x-csrf-token']).toBeUndefined();
    expect(init.credentials).toBe('include');
  });

  it('passes through a twoFactorRedirect body as a success, not an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { twoFactorRedirect: true }));

    const result = await authRequest<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: 'a@example.test', password: 'x' },
    });

    expect(result).toEqual({ twoFactorRedirect: true });
  });

  it('maps better-auth\'s own {message,code} error shape to ApiClientError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }));

    await expect(
      authRequest('/api/auth/sign-in/email', { method: 'POST', body: { email: 'a@example.test', password: 'wrong' } }),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
  });
});
