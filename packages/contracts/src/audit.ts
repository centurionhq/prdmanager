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
