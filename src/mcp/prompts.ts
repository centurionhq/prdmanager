import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { docId } from '../domain/schema.js';
import { getWorkOrderContext } from '../workorders/context.js';
import type { PrdmDeps } from './deps.js';
import { jsonText } from './shared.js';

function instructions(id: string): string[] {
  return [
    `You are implementing ${id}.`,
    '1. Read the context bundle below: the Blueprint(s), the Feature lineage above them, related Artifacts/Feedback and the governed code paths.',
    '2. If the work order is not already in_progress, call claim_work_order first.',
    '3. Modify only the code governed by its Blueprint(s); do not touch files outside that scope without justification.',
    '4. Run the project test suite and make sure it passes.',
    `5. Commit your changes with a message that includes the trailer \`Refs: ${id}\`.`,
    '6. Call complete_work_order with this id and the resulting commit sha.',
  ];
}

export function registerPrdmPrompts(server: McpServer, deps: PrdmDeps): void {
  server.registerPrompt(
    'implement_work_order',
    {
      title: 'Implement work order',
      description: 'Guides an assistant through claiming, implementing and completing a Work Order, including its full context bundle.',
      argsSchema: { id: docId },
    },
    async ({ id }: { id: string }) => {
      const context = await getWorkOrderContext(deps.store, id);
      if (!context) throw new Error(`work order ${id} not found`);
      const text = [...instructions(id), '', 'Context bundle:', jsonText(context)].join('\n');
      return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
    },
  );
}
