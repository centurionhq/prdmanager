import { ApiClientError, type ApiErrorCode } from './api-client-error';

interface ApiErrorBody {
  error: { code: string; message: string };
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const { error } = body as { error: unknown };
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

/** `undefined` for a `204`/empty body; every route in SDD-005's contract always returns a JSON body, but an empty
 * response should fail as a malformed body rather than crash `JSON.parse` on an empty string. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text);
}

/**
 * Shared fetch + parse for every `api/client.ts` function (SDD-005 "Frontend" `api/client.ts`): converts a
 * non-2xx response or a malformed body into a single `ApiClientError`, so callers never handle `fetch` rejections
 * or `JSON.parse` failures directly.
 */
export async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });

  let body: unknown;
  try {
    body = await readJson(response);
  } catch {
    throw new ApiClientError(response.status, 'unknown', `malformed response body from ${path}`);
  }

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiClientError(response.status, body.error.code as ApiErrorCode, body.error.message);
    }
    throw new ApiClientError(response.status, 'unknown', `request to ${path} failed with status ${response.status}`);
  }

  if (body === undefined) {
    throw new ApiClientError(response.status, 'unknown', `empty response body from ${path}`);
  }

  return body as T;
}
