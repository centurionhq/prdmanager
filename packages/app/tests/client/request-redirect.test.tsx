import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLoginRedirectUrl, loginDestinationFromNext, request } from '../../src/api/request.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('loginDestinationFromNext', () => {
  it('names organization and project from a project route', () => {
    expect(loginDestinationFromNext('/o/centurionhq/p/prdmanager/planta')).toEqual({ orgSlug: 'centurionhq', projSlug: 'prdmanager' });
  });

  it.each(['/o/centurionhq/ajustes/miembros', '/o/centurionhq'])('names only the organization for %s', (next) => {
    expect(loginDestinationFromNext(next)).toEqual({ orgSlug: 'centurionhq', projSlug: null });
  });

  it('ignores query and hash after the destination', () => {
    expect(loginDestinationFromNext('/o/centurionhq/p/prdmanager/planta?estado=vacio#x')).toEqual({
      orgSlug: 'centurionhq',
      projSlug: 'prdmanager',
    });
  });

  it.each([null, undefined, '/proyectos'])('returns null for %s', (next) => {
    expect(loginDestinationFromNext(next)).toBeNull();
  });

  it.each(['//evil.com/o/centurionhq/p/prdmanager', 'https://evil.com/o/centurionhq', '/\\evil.com', '/\t/evil.com'])(
    'returns null for open-redirect pattern %j',
    (next) => {
      expect(loginDestinationFromNext(next)).toBeNull();
    },
  );
});

describe('buildLoginRedirectUrl', () => {
  it('appends a root-relative path as next=', () => {
    expect(buildLoginRedirectUrl('/o/acme/p/factory/ordenes')).toBe('/login?next=%2Fo%2Facme%2Fp%2Ffactory%2Fordenes');
  });

  it('preserves a query string on the current path', () => {
    expect(buildLoginRedirectUrl('/o/acme/p/factory/ordenes?estado=vacio')).toBe(
      '/login?next=%2Fo%2Facme%2Fp%2Ffactory%2Fordenes%3Festado%3Dvacio',
    );
  });

  it('drops next= for a protocol-relative path (open redirect)', () => {
    expect(buildLoginRedirectUrl('//evil.com')).toBe('/login');
  });

  it('drops next= for an absolute URL with its own scheme', () => {
    expect(buildLoginRedirectUrl('https://evil.com')).toBe('/login');
  });

  it('drops next= for a path that is not root-relative', () => {
    expect(buildLoginRedirectUrl('evil.com')).toBe('/login');
  });

  it('drops next= for a backslash path the URL parser treats as protocol-relative', () => {
    // The WHATWG URL parser (same algorithm as `location.href`/`<a href>`) treats `\` as `/`, so
    // `new URL('/\\evil.com', origin).host` is `evil.com`, not the current origin.
    expect(buildLoginRedirectUrl('/\\evil.com')).toBe('/login');
  });

  it('drops next= for a tab-injected path the URL parser strips into protocol-relative', () => {
    // Literal control characters are stripped by the URL parser before it runs, so `/\t/evil.com`
    // resolves the same way `//evil.com` does even though the raw string never contains `//`.
    expect(buildLoginRedirectUrl('/\t/evil.com')).toBe('/login');
  });

  it('drops next= for a newline-injected path the URL parser strips into protocol-relative', () => {
    expect(buildLoginRedirectUrl('/\n/evil.com')).toBe('/login');
  });
});

describe('request() on a 401', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    originalLocation = window.location;
    // jsdom's window.location setters throw "not implemented" for navigation; replace it wholesale.
    Reflect.deleteProperty(window, 'location');
    (window as unknown as { location: Location }).location = {
      ...originalLocation,
      pathname: '/o/acme/p/factory/ordenes',
      search: '',
      hash: '',
      href: '',
    } as Location;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'location');
    (window as unknown as { location: Location }).location = originalLocation;
  });

  it('redirects to /login with the current path as next=', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'unauthorized', message: 'session expired' } }));

    await expect(request('/api/app/organizations')).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe('/login?next=%2Fo%2Facme%2Fp%2Ffactory%2Fordenes');
  });

  it('never redirects to an off-origin next for a malicious current path', async () => {
    window.location.pathname = '//evil.com';
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'unauthorized', message: 'session expired' } }));

    await expect(request('/api/app/organizations')).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe('/login');
  });

  it('does not redirect on a non-401 error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: { code: 'forbidden', message: 'nope' } }));

    await expect(request('/api/app/organizations')).rejects.toMatchObject({ status: 403 });
    expect(window.location.href).toBe('');
  });
});
