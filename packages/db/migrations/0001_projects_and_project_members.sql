CREATE TYPE "public"."project_role" AS ENUM('admin', 'editor', 'developer', 'commenter', 'viewer');--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role" "project_role" NOT NULL,
	CONSTRAINT "project_members_pkey" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"graph_project_id" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"graph_version" bigint DEFAULT 0 NOT NULL,
	"graph_dirty" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_graph_project_id_unique" UNIQUE("graph_project_id"),
	CONSTRAINT "projects_org_id_slug_key" UNIQUE("org_id","slug"),
	CONSTRAINT "projects_id_org_id_key" UNIQUE("id","org_id"),
	CONSTRAINT "projects_graph_project_id_format" CHECK ("projects"."graph_project_id" ~ '^prj_[0-9a-f]{16}$')
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_org_id_idx" ON "project_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "projects_org_id_idx" ON "projects" USING btree ("org_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas — hand-appended below drizzle-kit's own output (append-only from
-- here). RLS is both ENABLEd and FORCEd: FORCE makes the policy apply even to this table's owner
-- (prdm_owner), except prdm_owner is the bootstrap superuser and superusers always bypass RLS
-- regardless of FORCE — which is exactly why test fixtures that need to see/insert across multiple
-- orgs at once go through `pg.ownerPool`, never `pg.appPool`.
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "projects_tenant_isolation" ON "projects"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "project_members_tenant_isolation" ON "project_members"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Grants: prdm_app gets exactly the DML the tenant-scoped repositories (WO-100) issue. No CREATE, no
-- TRUNCATE, no ownership change — those stay with prdm_owner (migrations only).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "projects" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "project_members" TO prdm_app;