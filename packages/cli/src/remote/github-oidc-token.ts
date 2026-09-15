/**
 * Fetches a GitHub Actions OIDC token for `prdm sync`'s remote mode (SDD-010, WO-195: "en CI se adjunta
 * el OIDC token de GitHub Actions"). GitHub Actions exposes `ACTIONS_ID_TOKEN_REQUEST_URL`/
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN` only when the job's `permissions` grant `id-token: write`; outside
 * that (any non-CI run, or CI without the permission) this returns `undefined` rather than throwing —
 * `prdm sync` degrades to preview mode in that case, exactly like a personal token would.
 */
export interface FetchGithubOidcTokenDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

interface OidcTokenResponse {
  value: string;
}

/** `audience` must equal what the server's OIDC verification expects for `aud` (SDD-010: `PRDM_PUBLIC_URL`) —
 * the resolved server origin `prdm sync` is talking to. */
export async function fetchGithubActionsOidcToken(audience: string, deps: FetchGithubOidcTokenDeps): Promise<string | undefined> {
  const requestUrl = deps.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = deps.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) return undefined;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(requestUrl);
  url.searchParams.set('audience', audience);

  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${requestToken}` } });
  if (!response.ok) throw new Error(`could not fetch a GitHub Actions OIDC token: request responded ${response.status}`);
  const body = (await response.json()) as Partial<OidcTokenResponse>;
  if (typeof body.value !== 'string' || body.value.length === 0) throw new Error('GitHub Actions OIDC token endpoint returned no token value');
  return body.value;
}
