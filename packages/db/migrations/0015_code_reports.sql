CREATE TYPE "public"."code_report_mode" AS ENUM('baseline', 'preview');--> statement-breakpoint
CREATE TABLE "code_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"token_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"body_sha256" text NOT NULL,
	"mode" "code_report_mode" NOT NULL,
	"head_sha" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_reports_project_token_idempotency_key" UNIQUE("project_id","token_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "code_reports" ADD CONSTRAINT "code_reports_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_reports" ADD CONSTRAINT "code_reports_project_org_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_reports_org_id_idx" ON "code_reports" USING btree ("org_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas — same template as every other tenant table (ENABLE + FORCE,
-- NULLIF-based tenant policy).
ALTER TABLE "code_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "code_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "code_reports_tenant_isolation" ON "code_reports"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- prdm_app needs SELECT (the idempotency-conflict read-back) and INSERT (the reservation itself); no
-- UPDATE/DELETE — a code_reports row is written exactly once and never mutated afterward.
GRANT SELECT, INSERT ON TABLE "code_reports" TO prdm_app;