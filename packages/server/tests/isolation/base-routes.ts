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

  // WO-343: same tenant-scoped resolution as .../invitations/:invitationId/revoke above.
  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/invitations/:invitationId/resend', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, invitationId: f.invitationA.id } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug } })),
  });

  // WO-336: aggregates only the caller's own visible projects in this org — org B's owner sees org A's
  // slug resolve to nothing (no `projectA1`-shaped id ever appears in an org-B-scoped call), so this is
  // the same crossOrg-only shape as `GET .../projects` right below (no "other project" case: the whole
  // point of this route is aggregating every visible project at once, not scoping to one).
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/overview', {
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

  // WO-337: metrics/search/branch, same tenant-scoped store resolution as every other .../graph/* route.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/metrics', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/search', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, query: { q: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, query: { q: 'probe' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/branch/:nodeId', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, nodeId: 'PRD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, nodeId: 'PRD-001' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/work-orders', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  // WO-342: project/org audit log, same tenant-scoped resolution as every other route in each family.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/audit-log', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/audit-log', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug } })),
  });

  // WO-341: commits/code-refs, same tenant-scoped resolution as every other
  // .../projects/:projectSlug/* read below.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/commits', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/code-refs', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  // WO-340: drift issues/report-detail, same tenant-scoped resolution as every other
  // .../projects/:projectSlug/* read below.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/issues', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports/:reportId', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, reportId: '00000000-0000-0000-0000-000000000000' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, reportId: '00000000-0000-0000-0000-000000000000' } })),
  });

  // WO-335: same tenant-scoped resolution as every other .../projects/:projectSlug/* read below.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/line-board', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  // WO-338: work order context/claim/complete, same tenant-scoped resolution as every other
  // .../projects/:projectSlug/* route — resolveVisibleProject() 404s before a real woId is ever looked up.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/context', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/claim', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/complete', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' }, body: { commitSha: 'a'.repeat(40) } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' }, body: { commitSha: 'a'.repeat(40) } })),
  });

  // WO-415 (SDD-018): same tenant-scoped resolution as claim/complete above.
  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/archive', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' }, body: { reason: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, woId: 'WO-001' }, body: { reason: 'probe' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/batch', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { action: 'archive', ids: ['WO-001'] } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { action: 'archive', ids: ['WO-001'] } })),
  });

  // WO-339: feedback submit/inbox/candidates/triage, same tenant-scoped resolution as every other
  // .../projects/:projectSlug/* route.
  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { text: 'probe', source: 'support' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { text: 'probe', source: 'support' } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/inbox', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/candidates', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/triage', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' }, body: { root: true } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' }, body: { root: true } })),
  });

  // SDD-065 (WO-619): same tenant-scoped resolution as triage above -- dismiss, duplicate and the
  // batch endpoint all resolve the project from the URL before any permission or body check.
  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/dismiss', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' }, body: { reason: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' }, body: { reason: 'probe' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/duplicate', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' }, body: { duplicateOf: 'FB-002' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'FB-001' }, body: { duplicateOf: 'FB-002' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/triage-batch', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { action: 'dismiss', ids: ['FB-001'] } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { action: 'dismiss', ids: ['FB-001'] } })),
  });

  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/drift', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug } })),
  });

  // WO-199: the drift dashboard's report-history endpoint, same tenant-scoped resolution as /drift above.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports', {
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

  // WO-419 (SDD-018): same tenant-scoped resolution as close above.
  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/force-close', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { reason: 'probe', bypass: ['project_clean'] } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'PRD-001' }, body: { reason: 'probe', bypass: ['project_clean'] } })),
  });

  // WO-430 (SDD-021): same tenant-scoped resolution as generate-work-orders above -- docId is a blueprint.
  registerIsolationProbe('GET', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/impacts-paths/drift', {
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'SDD-001' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'SDD-001' } })),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/impacts-paths/sync', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'SDD-001' }, body: { expectedSuggestion: ['probe.ts'], reason: 'probe' } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug, docId: 'SDD-001' }, body: { expectedSuggestion: ['probe.ts'], reason: 'probe' } })),
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

  registerIsolationProbe('GET', '/api/app/profile', {
    skip: 'scoped to the caller\'s own session, user_profile is a global 1:1 with user — no org/project id in the path to probe (WO-432)',
  });

  registerIsolationProbe('POST', '/api/app/profile/handle', {
    mutating: true,
    skip: 'scoped to the caller\'s own session, user_profile is a global 1:1 with user — no org/project id in the path to probe (WO-432)',
  });

  registerIsolationProbe('POST', '/api/app/profile/work-profile', {
    mutating: true,
    skip: 'scoped to the caller\'s own session, user_work_profile is a global 1:1 with user — no org/project id in the path to probe (WO-542)',
  });

  // SDD-010 (WO-178): resolved through `resolveProjectByGraphProjectId` before `app.org_id` is ever
  // set, so an org-B bearer token targeting org A's `graphProjectId` must 404 exactly like a
  // nonexistent project id would — no `sameOrgOtherProject` case: an unscoped org-A token is allowed
  // to read any project in its own org (SDD-010 never adds a per-user role check to this route, only
  // token-scope + org-ownership + optional `project_ids`).
  // SDD-010 (WO-184): a fuller MCP-specific battery (same-project-id-different-org tool calls, a
  // project_ids-scoped token) lives in WO-185's own extension of this suite; this base entry only
  // proves the same IDOR-safe 404 every other bearer route already gets.
  registerIsolationProbe('POST', '/mcp/:graphProjectId', {
    mutating: true,
    crossOrg: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgBOwnerBearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } },
    }),
    // A personal token restricted via `project_ids` to `projectA2` attempting `projectA1` — same org,
    // same caller, same role; only the token's own `project_ids` differs (SDD-010, WO-185).
    sameOrgOtherProject: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgAScopedToProjectA2BearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } },
    }),
  });
  registerIsolationProbe('GET', '/mcp/:graphProjectId', {
    skip: 'always answers 405 by hand before any tenant resolution runs — no 404 signal to probe',
  });
  registerIsolationProbe('DELETE', '/mcp/:graphProjectId', {
    skip: 'always answers 405 by hand before any tenant resolution runs — no 404 signal to probe',
  });
  registerIsolationProbe('POST', '/mcp', {
    skip: 'lists projects the caller\'s own token/org can already see — no other org\'s resource id to probe',
  });
  registerIsolationProbe('GET', '/mcp', {
    skip: 'always answers 405 by hand before any tenant resolution runs — no 404 signal to probe',
  });
  registerIsolationProbe('DELETE', '/mcp', {
    skip: 'always answers 405 by hand before any tenant resolution runs — no 404 signal to probe',
  });

  registerIsolationProbe('GET', '/api/v1/projects/:graphProjectId/governance', {
    crossOrg: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgBOwnerBearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId } },
    }),
  });

  // SDD-010 (WO-180): same IDOR-safe resolution as governance, before any idempotency-key/body work
  // even starts — org B's bearer token (only `governance:read`, not `reports:write`) already 403s
  // before it could reach a 404, but is still a legitimate cross-tenant probe: no `reports:write`
  // scope should ever be reachable, from any org, against a project it doesn't own.
  registerIsolationProbe('POST', '/api/v1/projects/:graphProjectId/code-reports', {
    mutating: true,
    crossOrg: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgBOwnerBearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId }, body: {} },
    }),
  });

  // SDD-087 (WO-691): `reports:baseline` is CI-token-only, so the cross-org caller is org B's CI token.
  registerIsolationProbe('POST', '/api/v1/projects/:graphProjectId/drift/acknowledge', {
    mutating: true,
    crossOrg: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgBCiBearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId }, body: { target: 'all', reason: 'isolation probe' } },
    }),
  });

  registerIsolationProbe('POST', '/api/v1/projects/:graphProjectId/policy-docs', {
    mutating: true,
    crossOrg: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgBOwnerBearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId }, body: { shas: ['a'.repeat(40)] } },
    }),
  });

  // SDD-010 (WO-192): same IDOR-safe resolution as governance/code-reports — resolved and rejected
  // before the request body (or the caller's actual `import` permission) is ever looked at, so an empty
  // body is enough to prove the 404.
  registerIsolationProbe('POST', '/api/v1/projects/:graphProjectId/import', {
    mutating: true,
    crossOrg: (fixtures) => ({
      credential: { kind: 'bearer', secret: fixtures.orgBOwnerBearerSecret },
      params: { path: { graphProjectId: fixtures.projectA1.graphProjectId }, body: {} },
    }),
  });

  registerIsolationProbe('POST', '/api/app/organizations/:orgSlug/projects/:projectSlug/code-reports/force-push-overrides', {
    mutating: true,
    crossOrg: crossOrgSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { headSha: 'a'.repeat(40) } })),
    sameOrgOtherProject: sameOrgOutsiderSession((f) => ({ path: { orgSlug: f.orgA.slug, projectSlug: f.projectA1.slug }, body: { headSha: 'a'.repeat(40) } })),
  });
}
