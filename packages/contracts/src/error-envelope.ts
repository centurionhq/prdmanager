import { z } from 'zod';

/**
 * Error codes shared by every prdm SaaS surface (SDD-006 §Arquitectura). A 500 (`internal_error`) never
 * leaks the underlying message: server code must map unexpected errors to a generic one before responding.
 */
export const ERROR_CODES = [
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  // Request body too large, rejected by the route's bodyLimit — 413.
  'payload_too_large',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function errorEnvelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}
