-- SDD-006 §Aislamiento por capas, point 3 (WO-097) — pre-tenant resolution functions for projects.
-- No table changes here (`drizzle-kit generate` sees no schema diff, hence this file is hand-written,
-- not drizzle-kit output, same as the tail of 0002/0003); the meta/_journal.json entry and
-- meta/0004_snapshot.json (a copy of 0003's snapshot with a fresh `id`/`prevId`) were added by hand so
-- a later `drizzle-kit generate` still diffs against the right baseline.
--
-- Both functions below follow the exact resolve_invitation template from 0003
-- (packages/db/src/invitations.ts's module doc comment): SECURITY DEFINER, owned by `prdm_owner`
-- (whoever runs migrations — never `prdm_app`), `SET search_path = pg_catalog, public` so they can't be
-- fooled by a same-named object planted in another schema reachable on the caller's own search_path,
-- and a return shape trimmed to exactly the columns the pre-tenant caller needs (`org_id` plus the
-- internal `id` when the lookup key itself isn't already that id) — nothing else from `projects` (no
-- `name`, `slug`, `settings`, ...) ever crosses this boundary. Both return zero rows for "no match"
-- rather than raising, so callers map "nothing resolved" to a 404 like any other lookup miss, exactly
-- like `resolve_invitation`.
--
-- `resolve_project`: the caller already has the internal uuid (e.g. from a `project_id` embedded in a
-- document or token grant) and only needs to learn which org it belongs to before opening a tenant
-- transaction for it.
CREATE FUNCTION "resolve_project"("p_project_id" uuid)
RETURNS TABLE("org_id" text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p."org_id"
    FROM "projects" p
   WHERE p."id" = p_project_id;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "resolve_project"(uuid) TO prdm_app;
--> statement-breakpoint

-- `resolve_graph_project`: the public CLI/MCP surface only ever knows `graph_project_id` (`prj_...`,
-- SDD-006 §Arquitectura "Glosario de identificadores"), so this also hands back the internal uuid `id`
-- the caller needs to actually open `withTenantTx`/`createTenantDb(...).forOrg(...).forProject(...)`
-- with — `graph_project_id` itself is never echoed back (the caller already has it).
CREATE FUNCTION "resolve_graph_project"("p_graph_project_id" text)
RETURNS TABLE("org_id" text, "project_id" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p."org_id", p."id" AS "project_id"
    FROM "projects" p
   WHERE p."graph_project_id" = p_graph_project_id;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "resolve_graph_project"(text) TO prdm_app;

-- DEVIATION (documented per WO-097's own wording, which anticipates this): `resolve_token` and
-- `resolve_document` are declared in scope by WO-097's title ("token, proyecto por uuid y por
-- graph_project_id, documento e invitación") but are deliberately NOT added by this migration.
-- `resolve_invitation` already landed in 0003 (WO-105). The two still missing here need tables that
-- don't exist yet on this branch: `api_tokens` (WO-109, SDD-006 §Modelo de datos) and the documents
-- table (WO-109's own scope note says "sigue el mismo patrón que WO-097", and SDD-007 owns the
-- document engine that table belongs to). Adding a `resolve_token`/`resolve_document` function ahead of
-- its table would either have no `FROM` target or reach into a table this SDD doesn't yet govern.
-- WO-109 must add `resolve_token(secret_hash)` and `resolve_document(document_uuid)` as siblings of the
-- two functions above, in their own migration, in the same file that creates `api_tokens`/the documents
-- table, using this exact template: `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, a
-- `GRANT EXECUTE ... TO prdm_app` and nothing broader, and a return shape trimmed to `org_id` plus
-- whatever minimal id(s) the caller needs. The catalog test extended below
-- (packages/db/tests/integration/catalog.test.ts) will automatically start checking those two functions
-- too, since it enumerates every SECURITY DEFINER function in `public` rather than naming them.
