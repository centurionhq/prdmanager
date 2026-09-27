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
import { getProductTreeTool } from './get-product-tree.js';
import { getProjectStatusTool } from './get-project-status.js';
import { getTemplateTool } from './get-template.js';
import { proposeEditTool } from './propose-edit.js';
import { readDocumentTool } from './read-document.js';
import { searchProjectTool } from './search-project.js';
import { toJsonSchemaParameters, type AgentTool } from './tool.js';
import { validateDocumentTool } from './validate-document.js';

export type { AgentTool } from './tool.js';
export { AgentToolError, AgentToolPermissionError, type AgentToolContext } from './context.js';

/** WO-169's six read-only tools, in the order SDD-009 §Herramientas lists them, plus WO-478 (SDD-037)'s
 * two orientation tools. A conversation's actual available toolset (WO-171) appends `propose_edit`
 * (WO-173) on top of this list.
 *
 * The orientation pair goes first because it is what a conversation *opens* with: every other read-only
 * tool except `search_project` needs an id the user never types, so before SDD-037 the agent had nothing
 * it could call to answer "how is the project going?" or "what does the product do?" and spent its first
 * tool call working out what it was even looking at. They are two tools rather than one with a `scope`
 * argument precisely so the model chooses between two descriptions that spell out the project/product
 * distinction, instead of having to guess an enum value. */
export const READ_ONLY_AGENT_TOOLS: readonly AgentTool[] = [
  getProjectStatusTool,
  getProductTreeTool,
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

/**
 * WO-526 (SDD-047/FB-026): says which argument was wrong.
 *
 * The message used to be the fixed "tool arguments did not match the expected schema". Observed in a
 * real session: the model got it, had nothing to correct, retried blind, and failed the same way — a
 * trivial mismatch turned into a lost turn.
 *
 * Only the *shape* of the argument is reported: the field path and what was expected, both of which
 * come from the schema this server wrote. Never the value the model sent, which could carry document
 * or user content — the caution that justified the fixed message applies to content, not to the form
 * of a call the model itself made.
 */
function describeSchemaFailure(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  const details = error.issues.slice(0, 4).map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${where}: ${issue.message}`;
  });
  return details.length > 0 ? `tool arguments did not match the expected schema — ${details.join('; ')}` : 'tool arguments did not match the expected schema';
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
  if (!parsed.success) return errorResult('invalid_arguments', describeSchemaFailure(parsed.error));

  try {
    const output = await tool.execute(ctx, parsed.data);
    return { ok: true, resultJson: truncateToolOutput(JSON.stringify(output)) };
  } catch (error: unknown) {
    if (error instanceof AgentToolError) return errorResult(error.code, error.message);
    return errorResult('tool_error', 'the tool failed unexpectedly');
  }
}
