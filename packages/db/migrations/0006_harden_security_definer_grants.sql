-- SDD-006 §Aislamiento por capas — security review #1 finding (MEDIUM): `CREATE FUNCTION` grants EXECUTE to
-- PUBLIC by default in Postgres. Every `resolve_*`/`read_platform_audit_log` SECURITY DEFINER function so far
-- only ever added `GRANT EXECUTE ... TO prdm_app` on top of that default, so — independent of the database-level
-- `REVOKE CONNECT FROM PUBLIC` in docker/postgres/init/01-roles.sh, which is what actually made this inert today —
-- any future login role would inherit callable access to every one of them. Revoke the PUBLIC grant explicitly so
-- "only prdm_app" is enforced at the object itself, not only by there being no other role yet.
--
-- No schema change (drizzle-kit generate sees no diff), hand-written like 0002's/0003's/0004's tails: the
-- meta/_journal.json entry and meta/0006_snapshot.json (a copy of 0005's snapshot with a fresh `id`, `prevId`
-- pointing at 0005's `id`) were added by hand so a later `drizzle-kit generate` still diffs against the right
-- baseline.
-- Trigger functions are invoked by the trigger mechanism itself, never called directly, so they were never
-- granted EXECUTE to prdm_app either — only PUBLIC's default grant needs revoking here.
REVOKE EXECUTE ON FUNCTION "guard_user_profile_handle_reuse"() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "read_platform_audit_log"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "resolve_invitation"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "resolve_project"(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "resolve_graph_project"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "resolve_token"(text) FROM PUBLIC;
