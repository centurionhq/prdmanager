/**
 * Agent tool registry (SDD-009 §Herramientas, WO-169): the six read-only tools this WO defines
 * (`propose_edit`, the one write-shaped tool, is WO-173's own module — the agent loop, WO-171, wires both
 * lists together). `buildToolDefinitions` is what `LlmClient.streamChat` advertises to the model;
 * `executeAgentTool` is what the agent loop calls once the model actually requests one.
 */
import type { LlmToolDefinition } from '../llm-client.js';
import { AgentToolError, truncateToolOutput, type AgentToolContext } from './context.js';
import { getFeatureBranchTool } from './get-feature-branch.js';
import { getNodeTool } from './get-node.js';
import { getTemplateTool } from './get-template.js';
import { proposeEditTool } from './propose-edit.js';
import { readDocumentTool } from './read-document.js';
import { searchProjectTool } from './search-project.js';
import { toJsonSchemaParameters, type AgentTool } from './tool.js';
import { validateDocumentTool } from './validate-document.js';

export type { AgentTool } from './tool.js';
export { AgentToolError, AgentToolPermissionError, type AgentToolContext } from './context.js';

/** WO-169's six read-only tools, in the order SDD-009 §Herramientas lists them. A conversation's actual
 * available toolset (WO-171) appends `propose_edit` (WO-173) on top of this list. */
export const READ_ONLY_AGENT_TOOLS: readonly AgentTool[] = [
  readDocumentTool,
  searchProjectTool,
  getNodeTool,
  getFeatureBranchTool,
  getTemplateTool,
  validateDocumentTool,
];

/** WO-173: every read-only tool plus `propose_edit`, the one write-shaped tool a conversation actually
 * uses (the endpoint, WO-172, passes this — not `READ_ONLY_AGENT_TOOLS` — to `runAgentLoop`). */
export const ALL_AGENT_TOOLS: readonly AgentTool[] = [...READ_ONLY_AGENT_TOOLS, proposeEditTool];

export function buildToolDefinitions(tools: readonly AgentTool[]): LlmToolDefinition[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: toJsonSchemaParameters(tool.inputSchema) }));
}

export interface AgentToolCallResult {
  /** Always valid JSON text — either the tool's own successful output or a `{error: {code, message}}`
   * envelope — since this is fed straight back to the model as a `role: 'tool'` message's `content`. */
  resultJson: string;
  /** `false` for both "unknown tool name" and any error the tool itself raised — the loop (WO-171) uses
   * this only to decide whether to log more loudly server-side, never to change what reaches the model. */
  ok: boolean;
}

function errorResult(code: string, message: string): AgentToolCallResult {
  return { ok: false, resultJson: JSON.stringify({ error: { code, message } }) };
}

/** Parses `argumentsJson` (the model's own, untrusted, possibly-malformed JSON), runs the named tool from
 * `tools`, and always resolves (never rejects) — every failure mode (unknown tool, invalid arguments,
 * permission denial, an unexpected internal error) becomes a `{error}` JSON result the model receives as
 * its tool result, so one bad tool call never aborts the whole agent turn. */
export async function executeAgentTool(ctx: AgentToolContext, tools: readonly AgentTool[], name: string, argumentsJson: string): Promise<AgentToolCallResult> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return errorResult('unknown_tool', `no such tool: ${name}`);

  let rawArgs: unknown;
  try {
    rawArgs = argumentsJson.trim().length === 0 ? {} : JSON.parse(argumentsJson);
  } catch {
    return errorResult('invalid_arguments', 'tool arguments were not valid JSON');
  }

  const parsed = tool.inputSchema.safeParse(rawArgs);
  if (!parsed.success) return errorResult('invalid_arguments', 'tool arguments did not match the expected schema');

  try {
    const output = await tool.execute(ctx, parsed.data);
    return { ok: true, resultJson: truncateToolOutput(JSON.stringify(output)) };
  } catch (error: unknown) {
    if (error instanceof AgentToolError) return errorResult(error.code, error.message);
    return errorResult('tool_error', 'the tool failed unexpectedly');
  }
}
