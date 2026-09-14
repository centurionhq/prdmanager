/**
 * The isolation probe table for every route `packages/server` registers today (SDD-006 §Aislamiento por
 * capas point 4, WO-111). Importing this module (done once, from `isolation.test.ts`) populates
 * `./registry.js`; a later WO importing `./registry.js` directly and calling `registerIsolationProbe`
 * again (SDD-008/SDD-010's extension point) adds to the same table without touching this file.
 *
 * Every entry either supplies `crossOrg` (org-B-caller-against-org-A's-ids) and, for project-scoped
 * routes, `sameOrgOtherProject` (org-A-outsider-against-project-A1) — or an explicit `skip` reason for a
 * route with no cross-tenant resource id to probe at all (it lists only the caller's own resources, or
 * creates a brand-new one).
 */
import { registerIsolationProbe } from './registry.js';
import type { RouteProbeCase, RouteProbeConfig } from './types.js';

const crossOrgSession =
  (build: (f: Parameters<NonNullable<RouteProbeConfig['crossOrg']>>[0]) => RouteProbeCase['params']) =>
  (fixtures: Parameters<NonNullable<RouteProbeConfig['crossOrg']>>[0]): RouteProbeCase => ({
    credential: { kind: 'session', cookie: fixtures.orgBOwnerSessionCookie },
    params: build(fixtures),
  });

const sameOrgOutsiderSession =
  (build: (f: Parameters<NonNullable<RouteProbeConfig['sameOrgOtherProject']>>[0]) => RouteProbeCase['params']) =>
  (fixtures: Parameters<NonNullable<RouteProbeConfig['sameOrgOtherProject']>>[0]): RouteProbeCase => ({
    credential: { kind: 'session', cookie: fixtures.orgAOutsiderSessionCookie },
    params: build(fixtures),
  });

export function registerBaseIsolationRoutes(): void {
  registerIsolationProbe('GET', '/api/app/organizations', {
    skip: 'lists organizations the caller is already a member of — no target org id to probe',
  });

  registerIsolationProbe('POST', '/api/app/organizations/active', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ body: { organizationId: f.orgA.id } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/members', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug } })),
  });

  registerIsolationProbe('PATCH', '/api/app/organizations/:orgSlug/members/:userId', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, userId: f.orgAOwnerUserId }, body: { role: 'admin' } })),
  });

  registerIsolationProbe('DELETE', '/api/app/organizations/:orgSlug/members/:userId', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, userId: f.orgAOwnerUserId } })),
  });

  registerIsolationProbe('POST', '/api/app/admin/organizations', {
    skip: 'creates a brand-new organization (superadmin-only) — not an existing tenant\'s resource',
  });

  registerIsolationProbe('GET', '/api/app/admin/organizations', {
    skip: 'superadmin-only, lists id/slug/name of every organization by design (WO-120) — not scoped to a caller\'s own tenant, so there is no "other org" to cross-tenant-probe',
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/invitations', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/invitations', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug }, body: { email: 'probe@example.test', role: 'member', projectGrants: [] } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/invitations/:invitationId/revoke', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, invitationId: f.invitationA.id } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug }, body: { slug: 'probe-project', name: 'Probe' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('PATCH', '/api/app/organizations/:orgSlug/projects/:projectSlug/settings', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { settings: {} } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { settings: {} } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/members', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/members', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { userId: f.orgAOwnerUserId, role: 'viewer' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({
      path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug },
      body: { userId: f.orgAOwnerUserId, role: 'viewer' },
    })),
  });

  registerIsolationProbe('PATCH', '/api/app/organizations/:orgSlug/projects/:projectSlug/members/:userId', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, userId: f.orgAOwnerUserId }, body: { role: 'viewer' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({
      path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, userId: f.orgAOwnerUserId },
      body: { role: 'viewer' },
    })),
  });

  registerIsolationProbe('DELETE', '/api/app/organizations/:orgSlug/projects/:projectSlug/members/:userId', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, userId: f.orgAOwnerUserId } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, userId: f.orgAOwnerUserId } })),
  });

  // WO-136: none of these need a real doc_id — resolveVisibleProject() already 404s a cross-org/
  // outsider caller before a route handler ever looks one up, so a plausible placeholder is enough.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { kind: 'PRD', title: 'Probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { kind: 'PRD', title: 'Probe' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/request-review', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/archive', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/publish', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { versionId: 'probe', contentHash: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { versionId: 'probe', contentHash: 'probe' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/generate-work-orders', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'SDD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'SDD-001' } })),
  });

  // SDD-008 (WO-154/156/157/158): same reasoning as every other documents/:docId probe above —
  // resolveVisibleProject() 404s a cross-org/outsider caller before any of these ever look up a real
  // doc_id, so a plausible placeholder is enough.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/blame', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { label: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { label: 'probe' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions/:versionNo/diff', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', versionNo: '1' }, query: { against: '1' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', versionNo: '1' }, query: { against: '1' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions/:versionNo/restore', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', versionNo: '1' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', versionNo: '1' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { startIndex: 0, endIndex: 1, body: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { startIndex: 0, endIndex: 1, body: 'probe' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/replies', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000' }, body: { body: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000' }, body: { body: 'probe' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/resolve', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/reopen', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000' } })),
  });

  registerIsolationProbe('DELETE', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/comments/:threadId/messages/:commentId', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({
      path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000', commentId: '00000000-0000-0000-0000-000000000000' },
    })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({
      path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001', threadId: '00000000-0000-0000-0000-000000000000', commentId: '00000000-0000-0000-0000-000000000000' },
    })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { target: 'all' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { target: 'all' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/full', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/tree', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/node/:nodeId', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, nodeId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, nodeId: 'PRD-001' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/work-orders', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/drift', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/closure-readiness', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/close', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/invitations/:id/accept', {
    skip: 'public (SDD-006: authenticated by the invitation\'s own one-time secret, not by org/project membership)',
  });

  registerIsolationProbe('GET', '/api/app/tokens', {
    crossOrg: crossOrgSession((f) => ({ query: { orgSlug: f.orgA.slug } })),
  });

  registerIsolationProbe('POST', '/api/app/tokens', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({
      body: { orgSlug: f.orgA.slug, name: 'probe', scopes: ['governance:read'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    })),
  });

  registerIsolationProbe('POST', '/api/app/tokens/:tokenId/revoke', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { tokenId: f.personalTokenA.id }, query: { orgSlug: f.orgA.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({
      path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug },
      body: { name: 'probe-ci', scopes: ['governance:read'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({
      path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug },
      body: { name: 'probe-ci', scopes: ['governance:read'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens/:tokenId/revoke', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, tokenId: f.ciTokenA1.id } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({
      path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, tokenId: f.ciTokenA1.id },
    })),
  });

  registerIsolationProbe('GET', '/api/v1/me', {
    skip: 'scoped to the caller\'s own token, any valid token — no org/project id in the path to probe',
  });

  // SDD-010 (WO-178): resolved through `resolveProjectByGraphProjectId` before `app.org_id` is ever
  // set, so an org-B bearer token targeting org A's `graphProjectId` must 404 exactly like a
  // nonexistent project id would — no `sameOrgOtherProject` case: an unscoped org-A token is allowed
  // to read any project in its own org (SDD-010 never adds a per-user role check to this route, only
  // token-scope + org-ownership + optional `project_ids`).
  registerIsolationProbe('GET', '/api/v1/projects/:graphProjectId/governance', {
    crossOrg: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgBOwnerBearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId } },
    }),
  });
}
