CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "access_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"message" text,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_request_org_id_status_idx" ON "access_request" USING btree ("org_id","status");
--> statement-breakpoint
-- SDD-099 §D1 — RLS habilitada y FORZADA, misma forma NULLIF que projects/invitation_secrets.
ALTER TABLE "access_request" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "access_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "access_request_tenant_isolation" ON "access_request"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
-- Grants: exactamente el DML que emite el repositorio (no hay DELETE en ningún camino).
GRANT SELECT, INSERT, UPDATE ON TABLE "access_request" TO prdm_app;