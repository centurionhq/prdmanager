CREATE TABLE "force_push_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"authorized_by" text NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "force_push_overrides_project_head_sha_key" UNIQUE("project_id","head_sha")
);
--> statement-breakpoint
ALTER TABLE "project_code_state" ADD COLUMN "latest_baseline_head_sha" text;--> statement-breakpoint
ALTER TABLE "force_push_overrides" ADD CONSTRAINT "force_push_overrides_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "force_push_overrides" ADD CONSTRAINT "force_push_overrides_authorized_by_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "force_push_overrides" ADD CONSTRAINT "force_push_overrides_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "force_push_overrides_org_id_idx" ON "force_push_overrides" USING btree ("org_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas — same template as every other tenant table.
ALTER TABLE "force_push_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "force_push_overrides" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "force_push_overrides_tenant_isolation" ON "force_push_overrides"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- prdm_app needs full CRUD: an admin creates an override (INSERT), the baseline gate reads it
-- (SELECT) and consumes it exactly once by deleting it (DELETE) — never UPDATE, an override is never
-- edited in place.
GRANT SELECT, INSERT, DELETE ON TABLE "force_push_overrides" TO prdm_app;