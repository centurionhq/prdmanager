import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ID_PATTERN } from '../domain/schema.js';
import type { PrdmDeps } from './deps.js';
import { jsonText } from './shared.js';

function firstValue(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
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
      const id = firstValue(variables.id ?? '');
      if (!ID_PATTERN.test(id)) throw new Error(`invalid node id: ${id}`);
      const node = await deps.store.getNode(id);
      if (!node) throw new Error(`node ${id} not found`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: jsonText(node) }] };
    },
  );
}
