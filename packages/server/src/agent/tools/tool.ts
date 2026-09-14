/**
 * `AgentTool<TInput>` (WO-169): the shape every tool in `./read-document.ts` etc. implements. `inputSchema`
 * is both the runtime validator for the model's own (untrusted — SDD-009 §Seguridad) JSON arguments and,
 * via zod 4's native `z.toJSONSchema`, the schema advertised to the provider (`./index.ts`).
 */
import type { z } from 'zod';
import type { AgentToolContext } from './context.js';

export interface AgentTool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute(ctx: AgentToolContext, input: TInput): Promise<unknown>;
}

/** Strips zod's own `$schema` metadata key — noise for a provider's `tools[].function.parameters`, which
 * only ever wants the bare JSON Schema object itself. */
export function toJsonSchemaParameters(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema?.() as Record<string, unknown> | undefined;
  if (!jsonSchema) throw new Error('schema does not support toJSONSchema');
  const { $schema: _drop, ...rest } = jsonSchema;
  return rest;
}
