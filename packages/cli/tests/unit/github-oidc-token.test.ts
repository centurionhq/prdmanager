import { describe, expect, test } from 'vitest';
import { fetchGithubActionsOidcToken } from '../../src/remote/github-oidc-token.js';

describe('fetchGithubActionsOidcToken (WO-195)', () => {
  test('returns undefined outside GitHub Actions (no request URL/token in env)', async () => {
    await expect(fetchGithubActionsOidcToken('https://app.example.test', { env: {} })).resolves.toBeUndefined();
  });

  test('requests the token with the given audience and the request token as Bearer auth', async () => {
    let seenUrl: URL | undefined;
    let seenAuth: string | undefined;
    const fetchImpl = (async (url, init) => {
      seenUrl = new URL(url as string);
      seenAuth = (init?.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ value: 'the-jwt' }), { status: 200 });
    }) as typeof fetch;

    const token = await fetchGithubActionsOidcToken('https://app.example.test', {
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-token' },
      fetchImpl,
    });

    expect(token).toBe('the-jwt');
    expect(seenUrl?.searchParams.get('audience')).toBe('https://app.example.test');
    expect(seenAuth).toBe('Bearer runner-token');
  });

  test('throws when the token endpoint fails', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(
      fetchGithubActionsOidcToken('https://app.example.test', {
        env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-token' },
        fetchImpl,
      }),
    ).rejects.toThrow(/responded 500/);
  });
});
