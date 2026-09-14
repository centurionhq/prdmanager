CREATE TYPE "public"."api_token_kind" AS ENUM('personal', 'project_ci');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"kind" "api_token_kind" NOT NULL,
	"user_id" text,
	"project_ids" uuid[],
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "api_tokens_kind_user_id_check" CHECK (("api_tokens"."kind" = 'personal' AND "api_tokens"."user_id" IS NOT NULL) OR ("api_tokens"."kind" = 'project_ci' AND "api_tokens"."user_id" IS NULL)),
	CONSTRAINT "api_tokens_expires_at_max_90d_check" CHECK ("api_tokens"."expires_at" <= "api_tokens"."created_at" + interval '90 days')
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_org_id_idx" ON "api_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens" USING btree ("user_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas — hand-appended below drizzle-kit's own output (append-only from
-- here, same shape as every prior migration: ENABLE + FORCE, NULLIF-based tenant policy).
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "api_tokens_tenant_isolation" ON "api_tokens"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Grants: prdm_app gets exactly the DML the tenant-scoped token repository (packages/db/src/tokens.ts)
-- issues. No CREATE, no TRUNCATE, no ownership change — those stay with prdm_owner (migrations only).
GRANT SELECT, INSERT, UPDATE ON TABLE "api_tokens" TO prdm_app;
--> statement-breakpoint

-- Resolution-before-tenant function (SDD-006 §Aislamiento por capas, point 3 — the WO-097 pattern,
-- anticipated by the 0004 migration's own module doc comment as "WO-109 must add resolve_token(secret_hash)
-- ... in the same file that creates api_tokens"): the *only* way `prdm_app` can look up which
-- organization a Bearer token's secret belongs to before `app.org_id` is ever set. Matches purely on
-- `secret_hash` (the sha256 of the 32 raw secret bytes carried in the `Authorization: Bearer` header,
-- never on any part of the visible `prefix`), returns exactly the columns the Bearer plugin needs to
-- build `request.token` and enforce expiry/revocation itself (both are returned rather than checked here,
-- so the caller can distinguish "revoked" from "expired" from "not found" instead of all three looking
-- like a lookup miss — mirroring `resolve_invitation`'s own division of labor with its caller). Returns
-- zero rows for no match, never raising, so "nothing resolved" maps to a 404/401 like any other lookup
-- miss.
--
-- DEVIATION (documented, per the 0004 migration's own note): `resolve_document(document_uuid)` is NOT
-- added here. It needs a `documents` table that doesn't exist on this branch yet — SDD-007 owns that
-- table and must add `resolve_document` as a sibling of this function in the migration that creates it,
-- using this exact template.
CREATE FUNCTION "resolve_token"("p_secret_hash" text)
RETURNS TABLE("id" uuid, "org_id" text, "kind" "api_token_kind", "user_id" text, "project_ids" uuid[], "scopes" text[], "expires_at" timestamp with time zone, "revoked_at" timestamp with time zone)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t."id", t."org_id", t."kind", t."user_id", t."project_ids", t."scopes", t."expires_at", t."revoked_at"
    FROM "api_tokens" t
   WHERE t."secret_hash" = p_secret_hash;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "resolve_token"(text) TO prdm_app;