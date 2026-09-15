/**
 * `POST /api/v1/projects/:graphProjectId/policy-docs` client (SDD-010, WO-183/WO-198): a single batched
 * request for a whole commit range's policy documents, each evaluated at its own sha's `first_seen_at` —
 * never "now", and never git's own (spoofable) commit-date metadata.
 */
import { policyDocsResponseSchema, type PolicyDocsResult } from '@prdm/contracts';
import { CliError } from '../errors.js';

export interface FetchPolicyDocsDeps {
  fetchImpl?: typeof fetch;
}

export async function fetchPolicyDocs(origin: string, graphProjectId: string, token: string, shas: readonly string[], deps: FetchPolicyDocsDeps = {}): Promise<PolicyDocsResult[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(new URL(`/api/v1/projects/${graphProjectId}/policy-docs`, origin), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ shas }),
      redirect: 'error',
    });
  } catch (err) {
    throw new CliError(`could not reach ${origin}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) throw new CliError(`could not fetch policy docs from ${origin}: responded ${response.status}`);

  const parsed = policyDocsResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new CliError(`${origin} returned an invalid policy-docs response`);
  return parsed.data.results;
}
