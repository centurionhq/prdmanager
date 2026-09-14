/**
 * Shared types for the isolation suite harness (SDD-006 §Aislamiento por capas point 4, WO-111).
 */
import type { buildServer } from '../../src/build-server.js';

export type BuiltApp = ReturnType<typeof buildServer>;

export type IsolationCredential = { kind: 'session'; cookie: string } | { kind: 'bearer'; secret: string };

export interface RouteProbeParams {
  path?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface RouteProbeCase {
  credential: IsolationCredential;
  params: RouteProbeParams;
}

/**
 * One entry per registered route (keyed by `${METHOD} ${path}` — Fastify's own route path pattern,
 * e.g. `/api/app/organizations/:orgSlug/projects/:projectSlug`). Every route the running server
 * actually registers with a non-`public` access must have an entry here (checked by
 * `isolation.test.ts`'s coverage test) — a newly added route with no entry fails the suite instead of
 * silently going untested.
 */
export interface RouteProbeConfig {
  /** Documents *why* no probe runs for this route (e.g. "lists the caller's own resources, no target
   * id to cross-tenant-probe" or "creates a new organization, not an existing tenant's resource") —
   * required precisely so a skip is a reviewed decision, not an accidental gap. */
  skip?: string;
  /** `true` for POST/PUT/PATCH/DELETE routes gated by CSRF (every mutating `/api/app/*` route) — the
   * harness completes the CSRF handshake for these before injecting the probe request. */
  mutating?: boolean;
  /** Org-B-caller-against-org-A's-ids probe (SDD-006 §Aislamiento point 4: "credenciales de la
   * organización B"). Omit only alongside `skip`. */
  crossOrg?: (fixtures: IsolationFixtures) => RouteProbeCase;
  /** Same-org-A-caller-without-a-project_members-row-in-A1 probe ("de otro proyecto de la misma
   * organización A") — only meaningful for routes actually scoped to one project; omit for
   * organization-level-only routes (there is no "other project" to be missing from). */
  sameOrgOtherProject?: (fixtures: IsolationFixtures) => RouteProbeCase;
}

export interface IsolationFixtures {
  /** A fresh, unique-per-run string planted into every org-A-owned text field the harness can reach;
   * asserted absent from every probe response body and every response header. */
  canary: string;
  orgA: { id: string; slug: string; name: string };
  orgB: { id: string; slug: string; name: string };
  projectA1: { id: string; slug: string; name: string };
  projectA2: { id: string; slug: string; name: string };
  invitationA: { id: string; email: string };
  personalTokenA: { id: string };
  ciTokenA1: { id: string };
  orgAOwnerUserId: string;
  /** Member of org A, but with a `project_members` row only in `projectA2` — never `projectA1` — the
   * "same org, other project" caller (SDD-006 §Aislamiento entre proyectos). */
  orgAOutsiderSessionCookie: string;
  orgAOwnerSessionCookie: string;
  /** Owner of an entirely unrelated organization — the "org B" caller. */
  orgBOwnerSessionCookie: string;
  orgBOwnerBearerSecret: string;
}
