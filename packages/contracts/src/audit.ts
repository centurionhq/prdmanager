/**
 * Redacted audit-log-entry DTO (SDD-012, WO-327): mirrors `@prdm/db`'s `audit_log` table
 * (`packages/db/src/schema/audit.ts`), deliberately dropping `ip`/`user_agent` — a client-facing audit
 * trail never needs (or should leak) a caller's network origin.
 */
import { z } from 'zod';

export const auditLogEntrySchema = z.object({
  id: z.string(),
  actor: z.object({ type: z.string(), id: z.string(), name: z.string().nullable().optional() }),
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
  /** Total del recorte filtrado (SDD-091); opcional para que un servidor viejo siga parseando. */
  total: z.number().int().min(0).optional(),
});
export type AuditLogPageDto = z.infer<typeof auditLogPageSchema>;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const isoInstant = z.string().refine((v) => ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v)), { message: 'invalid ISO-8601 instant' });

/** Filtros del listado de auditoría (SDD-091): todos opcionales; `from`/`to` inclusivos sobre `created_at`. */
export const auditLogQuerySchema = z.object({
  action: z.string().min(1).max(120).optional(),
  from: isoInstant.optional(),
  to: isoInstant.optional(),
  actorType: z.string().min(1).max(40).optional(),
  actorId: z.string().min(1).max(200).optional(),
});
export type AuditLogQueryDto = z.infer<typeof auditLogQuerySchema>;

/** Facetas de auditoría (SDD-091): acciones y actores distintos con conteo, y el total del alcance. */
export const auditFacetsSchema = z.object({
  actions: z.array(z.object({ action: z.string(), count: z.number().int().min(0) })),
  actors: z.array(z.object({ type: z.string(), id: z.string(), name: z.string().nullable(), count: z.number().int().min(0) })),
  total: z.number().int().min(0),
});
export type AuditFacetsDto = z.infer<typeof auditFacetsSchema>;
