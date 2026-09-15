CREATE TYPE "public"."commit_trust" AS ENUM('baseline', 'preview', 'import');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('MRD', 'PRD', 'FR', 'SDD', 'ADR', 'WO', 'ART', 'FB');--> statement-breakpoint
CREATE TYPE "public"."document_origin" AS ENUM('collab', 'generated', 'import');--> statement-breakpoint
CREATE TYPE "public"."document_version_reason" AS ENUM('manual', 'review_request', 'published', 'agent_accept', 'restore', 'engine_write', 'import');--> statement-breakpoint
CREATE TYPE "public"."document_workflow_state" AS ENUM('draft', 'in_review', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "commits" (
	"project_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"org_id" text NOT NULL,
	"trust" "commit_trust" NOT NULL,
	"reporter_token_id" uuid,
	"author" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"refs" text[] DEFAULT '{}'::text[] NOT NULL,
	"files" text[] DEFAULT '{}'::text[] NOT NULL,
	"branches" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commits_pkey" PRIMARY KEY("project_id","sha"),
	CONSTRAINT "commits_sha_format" CHECK ("commits"."sha" ~ '^[0-9a-f]{7,40}$')
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"label" text,
	"reason" "document_version_reason" NOT NULL,
	"yjs_state" "bytea",
	"rendered_markdown" text NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"contributors" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_document_id_version_no_key" UNIQUE("document_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"doc_id" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"title" text NOT NULL,
	"source_path" text NOT NULL,
	"origin" "document_origin" NOT NULL,
	"workflow_state" "document_workflow_state" DEFAULT 'draft' NOT NULL,
	"working_state" "bytea",
	"published_version_id" uuid,
	"published_raw" text,
	"published_content_hash" text,
	"last_validation" jsonb,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_project_id_doc_id_key" UNIQUE("project_id","doc_id"),
	CONSTRAINT "documents_id_org_id_key" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "id_counters" (
	"project_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "id_counters_pkey" PRIMARY KEY("project_id","kind")
);
--> statement-breakpoint
CREATE TABLE "project_baselines" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"baseline" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_code_state" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"latest_report_id" uuid,
	"latest_baseline_report_id" uuid,
	"impacts_hashes" jsonb
);
--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_reporter_token_id_api_tokens_id_fk" FOREIGN KEY ("reporter_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_org_fk" FOREIGN KEY ("document_id","org_id") REFERENCES "public"."documents"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_counters" ADD CONSTRAINT "id_counters_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_code_state" ADD CONSTRAINT "project_code_state_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commits_org_id_idx" ON "commits" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "document_versions_org_id_idx" ON "document_versions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "document_versions_document_id_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_org_id_idx" ON "documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "documents_project_id_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "id_counters_org_id_idx" ON "id_counters" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "project_baselines_org_id_idx" ON "project_baselines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "project_code_state_org_id_idx" ON "project_code_state" USING btree ("org_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas / SDD-007 — hand-appended below drizzle-kit's own output (append-only
-- from here, same shape as every prior migration: ENABLE + FORCE, NULLIF-based tenant policy) for all
-- six tables this migration creates.
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "documents_tenant_isolation" ON "documents"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "document_versions_tenant_isolation" ON "document_versions"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "id_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "id_counters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "id_counters_tenant_isolation" ON "id_counters"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "project_baselines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_baselines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "project_baselines_tenant_isolation" ON "project_baselines"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "commits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "commits_tenant_isolation" ON "commits"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "project_code_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_code_state" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "project_code_state_tenant_isolation" ON "project_code_state"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Grants: prdm_app gets exactly the DML the engine actually issues (SDD-007). documents/document_versions
-- are mutated by ordinary UPDATE/INSERT/DELETE (a working copy can be discarded, a generated document's
-- row can be superseded), so they get full CRUD; id_counters is a per-(project,kind) counter row that's
-- seeded once (INSERT) and then incremented in place (UPDATE), read to compute a fresh seed (SELECT),
-- never deleted; project_baselines is a per-project singleton the engine fully replaces on every refresh,
-- so it also gets full CRUD (UPSERT-shaped). commits/project_code_state get SELECT+INSERT+UPDATE only:
-- nothing in this WO's scope (or SDD-010's CI-report ingestion) ever needs to delete a commit or a
-- project's code-state row — see the module doc comment in packages/db/src/schema/documents.ts.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "documents" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "document_versions" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "id_counters" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "project_baselines" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "commits" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "project_code_state" TO prdm_app;
--> statement-breakpoint

-- Resolution-before-tenant function (SDD-006 §Aislamiento por capas, point 3; the WO-097/WO-109 pattern):
-- fills the "resolve_document(document_uuid)" DEVIATION note left open by both 0004
-- (resolve_project_functions) and 0005 (api_tokens) — this is the migration that finally creates the
-- `documents` table those notes were waiting on. Exact same template: SECURITY DEFINER, owned by
-- prdm_owner, SET search_path = pg_catalog, public, a trimmed return shape (org_id plus the project_id
-- the caller needs to open a tenant transaction — never doc_id/title/content), zero rows rather than
-- raising on no match, GRANT EXECUTE to prdm_app only.
CREATE FUNCTION "resolve_document"("p_document_id" uuid)
RETURNS TABLE("org_id" text, "project_id" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT d."org_id", d."project_id"
    FROM "documents" d
   WHERE d."id" = p_document_id;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "resolve_document"(uuid) TO prdm_app;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "resolve_document"(uuid) FROM PUBLIC;