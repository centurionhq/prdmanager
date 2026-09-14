CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_id_idx" ON "audit_log" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_project_id_idx" ON "audit_log" USING btree ("project_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas / §Modelo de datos — hand-appended below drizzle-kit's own output
-- (append-only from here).
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Append-only: prdm_app never gets UPDATE/DELETE/TRUNCATE on either audit table.
GRANT SELECT, INSERT ON TABLE "audit_log" TO prdm_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM prdm_app;
--> statement-breakpoint

-- platform_audit_log has no org_id/RLS at all (global, like the better-auth tables) and is locked
-- down further: prdm_app can INSERT but not SELECT — reading only goes through the SECURITY DEFINER
-- function below.
GRANT INSERT ON TABLE "platform_audit_log" TO prdm_app;
--> statement-breakpoint
REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON TABLE "platform_audit_log" FROM prdm_app;
--> statement-breakpoint

-- platform_admins: prdm_app gets SELECT only. Nothing anywhere grants it INSERT/UPDATE/DELETE — the
-- only way a row is ever added is a future prdm_owner-credentialed bootstrap command (WO-101).
GRANT SELECT ON TABLE "platform_admins" TO prdm_app;
--> statement-breakpoint

-- Resolution-before-tenant function (SDD-006 §Aislamiento por capas, point 3): the only way prdm_app
-- can ever read platform_audit_log. `callerUserId` is supplied by the server after it has already
-- verified (via better-auth's own session/2FA checks, WO-101/WO-102) that the caller is signed in as
-- that user; this function's own job is solely to gate the read on platform_admins membership, with a
-- locked-down search_path so it can't be tricked by a same-named object in another schema.
CREATE FUNCTION "read_platform_audit_log"("caller_user_id" text)
RETURNS SETOF "platform_audit_log"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "platform_admins" WHERE "user_id" = caller_user_id) THEN
    RAISE EXCEPTION 'caller % is not a platform admin', caller_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT * FROM "platform_audit_log" ORDER BY "created_at" DESC;
END;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "read_platform_audit_log"(text) TO prdm_app;