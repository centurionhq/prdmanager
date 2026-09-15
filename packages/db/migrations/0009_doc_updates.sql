CREATE TYPE "public"."doc_update_actor_kind" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TABLE "doc_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"actor_kind" "doc_update_actor_kind",
	"user_id" text,
	"on_behalf_of" text,
	"agent_id" text,
	"connection_id" text,
	"update" "bytea" NOT NULL,
	"struct_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delete_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_updates_document_id_seq_key" UNIQUE("document_id","seq")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "snapshot_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_updates" ADD CONSTRAINT "doc_updates_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_updates" ADD CONSTRAINT "doc_updates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_updates" ADD CONSTRAINT "doc_updates_on_behalf_of_user_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_updates" ADD CONSTRAINT "doc_updates_document_org_fk" FOREIGN KEY ("document_id","org_id") REFERENCES "public"."documents"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_updates_org_id_idx" ON "doc_updates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "doc_updates_document_id_idx" ON "doc_updates" USING btree ("document_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas / SDD-008 (WO-145) — hand-appended below drizzle-kit's own output,
-- same shape as every other tenant table (ENABLE + FORCE, NULLIF-based tenant policy).
ALTER TABLE "doc_updates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "doc_updates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "doc_updates_tenant_isolation" ON "doc_updates"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Append-only (SDD-008 §"Autoría por línea no falsificable": durable log written before broadcast,
-- never mutated or pruned by this WO's scope) — same grant shape as `audit_log`.
GRANT SELECT, INSERT ON TABLE "doc_updates" TO prdm_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "doc_updates" FROM prdm_app;