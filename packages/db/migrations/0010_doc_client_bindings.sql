CREATE TABLE "doc_client_bindings" (
	"document_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"actor_kind" "doc_update_actor_kind" NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_client_bindings_pkey" PRIMARY KEY("document_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "doc_client_bindings" ADD CONSTRAINT "doc_client_bindings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_client_bindings" ADD CONSTRAINT "doc_client_bindings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_client_bindings" ADD CONSTRAINT "doc_client_bindings_document_org_fk" FOREIGN KEY ("document_id","org_id") REFERENCES "public"."documents"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_client_bindings_org_id_idx" ON "doc_client_bindings" USING btree ("org_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas / SDD-008 (WO-149) — hand-appended below drizzle-kit's own output,
-- same shape as every other tenant table.
ALTER TABLE "doc_client_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "doc_client_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "doc_client_bindings_tenant_isolation" ON "doc_client_bindings"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Append-only (SDD-008: a binding is never reassigned/deleted once made) — same grant shape as
-- `audit_log`/`doc_updates`.
GRANT SELECT, INSERT ON TABLE "doc_client_bindings" TO prdm_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "doc_client_bindings" FROM prdm_app;