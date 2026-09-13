import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DRAFT_KINDS, ID_PATTERN, templateFor, type DraftKind } from '@prdm/core';
import type { PrdmDeps } from './deps.js';
import { ensureRecovered } from './recover.js';
import { jsonText } from './shared.js';
import { buildProjectSummary } from './tools-authoring.js';

function firstValue(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function isDraftKind(kind: string): kind is DraftKind {
  return (DRAFT_KINDS as readonly string[]).includes(kind);
}

export function registerPrdmResources(server: McpServer, deps: PrdmDeps): void {
  server.registerResource(
    'graph-node',
    new ResourceTemplate('graph://node/{id}', { list: undefined }),
    {
      title: 'Graph node',
      description: 'JSON view of a single graph node (Feature/Blueprint/WorkOrder/Artifact/Feedback) with its relationships.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      await ensureRecovered(deps);
      const id = firstValue(variables.id ?? '');
      if (!ID_PATTERN.test(id)) throw new Error(`invalid node id: ${id}`);
      const node = await deps.store.getNode(id);
      if (!node) throw new Error(`node ${id} not found`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: jsonText(node) }] };
    },
  );

  server.registerResource(
    'project',
    'prdm://project',
    {
      title: 'Project',
      description: 'JSON summary of the active project: id, name, folder map, lifecycle rules, document counts and open drafts (same data as the get_project tool).',
      mimeType: 'application/json',
    },
    async (uri) => {
      await ensureRecovered(deps);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: jsonText(await buildProjectSummary(deps)) }] };
    },
  );

  server.registerResource(
    'artifact-template',
    new ResourceTemplate('prdm://templates/{kind}', {
      list: async () => ({
        resources: DRAFT_KINDS.map((kind) => ({ uri: `prdm://templates/${kind}`, name: `${kind} template`, mimeType: 'text/markdown' })),
      }),
    }),
    {
      title: 'Artifact template',
      description: 'Markdown skeleton (frontmatter + section headings) for a draftable document kind: MRD, PRD, FR, SDD, ADR, FB or ART. There is no template for WO (generated only).',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const kind = firstValue(variables.kind ?? '');
      if (!isDraftKind(kind)) throw new Error(`unknown template kind: ${kind}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: templateFor(kind) }] };
    },
  );
}
