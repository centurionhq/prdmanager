/**
 * Search-result DTO (SDD-012, WO-327): mirrors the MCP `search_nodes` tool's result shape
 * (`packages/mcp/src/tools-read.ts`, `@prdm/core`'s `SearchHit`).
 */
import { z } from 'zod';

const NODE_LABELS = ['Feature', 'Blueprint', 'WorkOrder', 'Artifact', 'Feedback'] as const;

export const searchHitSchema = z.object({
  id: z.string(),
  label: z.enum(NODE_LABELS),
  title: z.string(),
  status: z.string(),
  score: z.number(),
});
export type SearchHitDto = z.infer<typeof searchHitSchema>;

export const searchResultSchema = z.object({
  results: z.array(searchHitSchema),
});
export type SearchResultDto = z.infer<typeof searchResultSchema>;
