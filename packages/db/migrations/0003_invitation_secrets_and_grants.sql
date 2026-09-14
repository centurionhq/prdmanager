CREATE TABLE "invitation_secrets" (
	"invitation_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_invitation_grants" (
	"invitation_id" text NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"role" "project_role" NOT NULL,
	CONSTRAINT "project_invitation_grants_pkey" PRIMARY KEY("invitation_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_secrets" ADD CONSTRAINT "invitation_secrets_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_secrets" ADD CONSTRAINT "invitation_secrets_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitation_grants" ADD CONSTRAINT "project_invitation_grants_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitation_grants" ADD CONSTRAINT "project_invitation_grants_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_secrets_org_id_idx" ON "invitation_secrets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invitation_secrets_secret_hash_idx" ON "invitation_secrets" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "project_invitation_grants_org_id_idx" ON "project_invitation_grants" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "project_invitation_grants_invitation_id_idx" ON "project_invitation_grants" USING btree ("invitation_id");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_id_organization_id_key" UNIQUE("id","organizationId");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas — hand-appended below drizzle-kit's own output (append-only from
-- here). Same RLS shape as projects/audit_log: ENABLE + FORCE, NULLIF-based tenant policy.
ALTER TABLE "invitation_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation_secrets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "invitation_secrets_tenant_isolation" ON "invitation_secrets"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "project_invitation_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_invitation_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "project_invitation_grants_tenant_isolation" ON "project_invitation_grants"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Grants: prdm_app gets exactly the DML the tenant-scoped invitation repositories (below) issue.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "invitation_secrets" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "project_invitation_grants" TO prdm_app;
--> statement-breakpoint

-- Resolution-before-tenant function (SDD-006 §Aislamiento por capas, point 3 — the WO-097 pattern,
-- named so WO-097 can add its own siblings, e.g. for tokens and projects, alongside this one): the
-- *only* way `prdm_app` can look up which organization a one-time invitation secret belongs to before
-- `app.org_id` is ever set. Matches purely on `secret_hash` (never on `invitation_id`/`org_id` supplied
-- by the caller) so an attacker who only knows an invitation id — visible in the accept URL's path —
-- learns nothing without the high-entropy secret from the URL fragment. Returns zero rows for no match,
-- rather than raising, so the caller maps "nothing resolved" to a 404 like any other lookup miss;
-- expiry and consumption are deliberately left to the caller's own transaction (the accept endpoint),
-- not enforced here, so it can distinguish "expired" from "already used" instead of both looking like
-- "not found".
CREATE FUNCTION "resolve_invitation"("p_secret_hash" text)
RETURNS TABLE("org_id" text, "invitation_id" text, "email" text, "expires_at" timestamp with time zone)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s."org_id", s."invitation_id", i."email", s."expires_at"
    FROM "invitation_secrets" s
    JOIN "invitation" i ON i."id" = s."invitation_id"
   WHERE s."secret_hash" = p_secret_hash;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "resolve_invitation"(text) TO prdm_app;