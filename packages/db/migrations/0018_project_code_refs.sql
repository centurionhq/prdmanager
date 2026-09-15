CREATE TABLE "project_code_refs" (
	"project_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"blueprint_id" text NOT NULL,
	"ref_key" text NOT NULL,
	"path" text NOT NULL,
	"symbol" text,
	"hash" text,
	"hash_algo_version" integer NOT NULL,
	"report_id" uuid NOT NULL,
	"head_sha" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_code_refs_pkey" PRIMARY KEY("project_id","blueprint_id","ref_key")
);
--> statement-breakpoint
ALTER TABLE "project_code_state" ADD COLUMN "governed_warnings" jsonb;--> statement-breakpoint
ALTER TABLE "project_code_refs" ADD CONSTRAINT "project_code_refs_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_code_refs_org_id_idx" ON "project_code_refs" USING btree ("org_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas — same template as every other tenant table (ENABLE + FORCE,
-- NULLIF-based tenant policy), same as migration 0015's own project-scoped table.
ALTER TABLE "project_code_refs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_code_refs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "project_code_refs_tenant_isolation" ON "project_code_refs"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- prdm_app needs full CRUD: WO-332's transactional replace deletes every row for a (project, blueprint)
-- pair and re-inserts the reported set (SELECT for buildDriftInput's own read, INSERT/DELETE for the
-- replace, UPDATE included per SDD-012 even though the replace itself never mutates a row in place).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "project_code_refs" TO prdm_app;