/**
 * `.../documents/:docId/agent/messages` validation shapes (SDD-009 §Diseño, WO-172).
 *
 * `AGENT_USER_MESSAGE_MAX_LENGTH` is intentionally much smaller than `@prdm/db`'s `agent_messages`
 * schema-level content cap (64 KB, which also has to fit tool-call/assistant-turn content) — a human's
 * own chat prompt has no reason to be that large, and a small, fast 400 here is friendlier than only ever
 * discovering the mismatch as an opaque 500 from the database CHECK constraint.
 */
import { z } from 'zod';

export const AGENT_USER_MESSAGE_MAX_LENGTH = 8 * 1024;

export const sendAgentMessageInputSchema = z.object({
  message: z.string().min(1).max(AGENT_USER_MESSAGE_MAX_LENGTH),
});
export type SendAgentMessageInput = z.infer<typeof sendAgentMessageInputSchema>;
