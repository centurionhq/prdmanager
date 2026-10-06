/**
 * Redacted audit-log-entry DTO (SDD-012, WO-327): mirrors `@prdm/db`'s `audit_log` table
 * (`packages/db/src/schema/audit.ts`), deliberately dropping `ip`/`user_agent` — a client-facing audit
 * trail never needs (or should leak) a caller's network origin.
 */
import { z } from 'zod';

export const auditLogEntrySchema = z.object({
  id: z.string(),
  actor: z.object({ type: z.string(), id: z.string() }),
  action: z.string(),
  target: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditLogEntryDto = z.infer<typeof auditLogEntrySchema>;

/** The page both audit endpoints answer with (`GET .../audit-log` at project and organisation scope): the
 * entries plus the keyset cursor of the next page, `null` on the last one. Shared so the server and the client
 * cannot disagree about it again -- they did (`entries` on the wire, `items` in the client), and both audit
 * screens crashed in the real app while every test that mocked the client's own assumption passed. */
export const auditLogPageSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogPageDto = z.infer<typeof auditLogPageSchema>;
