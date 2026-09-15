/**
 * `prdm login`/`prdm logout` (SDD-010 "CLI: credenciales y vinculación", WO-187): verifies a personal
 * API token against `GET /api/v1/me` before ever storing it, and every `fetch` call in this flow uses
 * `redirect: 'error'` — a token must never be silently forwarded to a host the server itself redirects
 * to, whether that's a misconfiguration or something more hostile.
 */
import { CliError } from '../errors.js';
import { loadCredentials, saveCredentials, type CredentialsFile } from './credentials.js';
import { parseServerUrl } from './server-url.js';

export interface LoginIoDeps {
  stdout: (line: string) => void;
  askHidden: (question: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** Never logs the token itself, and never trusts a redirected response as a valid `/api/v1/me` reply
 * (SDD-010: "fetch con redirect: 'error'; nunca sigue una redirección"). */
async function verifyToken(origin: string, token: string, fetchImpl: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(new URL('/api/v1/me', origin), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
    });
  } catch (err) {
    throw new CliError(`could not reach ${origin}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new CliError(`login failed: ${origin}/api/v1/me responded ${response.status}`);
  }
}

export async function runLogin(server: string, token: string, deps: LoginIoDeps): Promise<void> {
  const url = parseServerUrl(server);
  const trimmedToken = token.trim();
  if (trimmedToken.length === 0) throw new CliError('a token is required');

  await verifyToken(url.origin, trimmedToken, deps.fetchImpl ?? fetch);

  const credentials = loadCredentials(deps.env);
  const next: CredentialsFile = { ...credentials, [url.origin]: { token: trimmedToken } };
  saveCredentials(next, deps.env);
  deps.stdout(`logged in to ${url.origin}`);
}

export interface LogoutIoDeps {
  stdout: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

/**
 * Removes the credential for `server`'s origin, or — when `server` is omitted — the sole stored
 * credential if there is exactly one. SDD-010 says logout targets "the current (or a specified)
 * origin"; with no `prdm link`-local project config in scope for this WO (a later WO owns that), "the
 * current one" is only unambiguous when there is exactly one stored credential to begin with, so that
 * is the fallback implemented here — anything else requires `--server` explicitly.
 */
export async function runLogout(server: string | undefined, deps: LogoutIoDeps): Promise<void> {
  const credentials = loadCredentials(deps.env);

  let origin: string;
  if (server) {
    origin = parseServerUrl(server).origin;
  } else {
    const origins = Object.keys(credentials);
    if (origins.length !== 1) {
      throw new CliError(origins.length === 0 ? 'not logged in to any server' : 'multiple servers stored; pass --server <url> to choose one');
    }
    origin = origins[0]!;
  }

  if (!(origin in credentials)) {
    deps.stdout(`not logged in to ${origin}`);
    return;
  }

  const next = { ...credentials };
  delete next[origin];
  saveCredentials(next, deps.env);
  deps.stdout(`logged out of ${origin}`);
}
