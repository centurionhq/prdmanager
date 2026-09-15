/**
 * `prdm link`'s server-side project resolution (SDD-010 "CLI: credenciales y vinculación", WO-188):
 * verifies the stored token really belongs to `<org>` via `GET /api/v1/me`, then resolves `<project>`'s
 * `graph_project_id` through the bare `POST /mcp`'s `list_projects` tool (WO-184) — there is no separate
 * REST lookup for this in SDD-010's surface, and `list_projects` already returns exactly `{id, name,
 * slug}` for every project the token's organization can see.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CliError } from '../errors.js';

export interface ResolveRemoteProjectDeps {
  fetchImpl?: typeof fetch;
}

export interface ResolvedRemoteProject {
  graphProjectId: string;
  name: string;
}

interface MeResponse {
  organization: { id: string; slug: string; name: string };
}

interface ListProjectsResult {
  projects: { id: string; name: string; slug: string }[];
}

async function verifyOrg(origin: string, token: string, org: string, fetchImpl: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(new URL('/api/v1/me', origin), { method: 'GET', headers: { authorization: `Bearer ${token}` }, redirect: 'error' });
  } catch (err) {
    throw new CliError(`could not reach ${origin}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) throw new CliError(`could not verify token against ${origin}/api/v1/me (responded ${response.status})`);
  const body = (await response.json()) as MeResponse;
  if (body.organization.slug !== org) {
    throw new CliError(`this token belongs to organization "${body.organization.slug}", not "${org}"`);
  }
}

/** Resolves `<org>/<project>` against `origin`, or throws `CliError` when the token doesn't belong to
 * `org`, or no project named `project` is visible to it. Never invents a `graphProjectId` locally. */
export async function resolveRemoteProject(origin: string, token: string, org: string, project: string, deps: ResolveRemoteProjectDeps = {}): Promise<ResolvedRemoteProject> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await verifyOrg(origin, token, org, fetchImpl);

  const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), { fetch: fetchImpl, requestInit: { headers: { authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'prdm-link', version: '0.0.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    if (result.isError) throw new CliError(`could not list projects on ${origin}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
    const data = result.structuredContent as ListProjectsResult | undefined;
    const match = data?.projects.find((p) => p.slug === project);
    if (!match) throw new CliError(`project "${project}" not found in organization "${org}" (or this token cannot see it)`);
    return { graphProjectId: match.id, name: match.name };
  } finally {
    await client.close();
  }
}
