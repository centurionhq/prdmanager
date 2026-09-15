CREATE TYPE "public"."doc_thread_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "doc_comment_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"anchor_start" "bytea" NOT NULL,
	"anchor_end" "bytea" NOT NULL,
	"quoted_text" text NOT NULL,
	"status" "doc_thread_status" DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_comment_threads_id_org_id_key" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "doc_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "doc_comments_body_length" CHECK (char_length("doc_comments"."body") <= 10240),
	CONSTRAINT "doc_comments_body_no_control_chars" CHECK ("doc_comments"."body" !~ E'[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]')
);
--> statement-breakpoint
ALTER TABLE "doc_comment_threads" ADD CONSTRAINT "doc_comment_threads_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comment_threads" ADD CONSTRAINT "doc_comment_threads_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comment_threads" ADD CONSTRAINT "doc_comment_threads_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comment_threads" ADD CONSTRAINT "doc_comment_threads_document_org_fk" FOREIGN KEY ("document_id","org_id") REFERENCES "public"."documents"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_thread_org_fk" FOREIGN KEY ("thread_id","org_id") REFERENCES "public"."doc_comment_threads"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_comment_threads_org_id_idx" ON "doc_comment_threads" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "doc_comment_threads_document_id_idx" ON "doc_comment_threads" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_comments_org_id_idx" ON "doc_comments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "doc_comments_thread_id_idx" ON "doc_comments" USING btree ("thread_id");
--> statement-breakpoint

-- SDD-006 §Aislamiento por capas / SDD-008 (WO-158) — hand-appended below drizzle-kit's own output,
-- same shape as every other tenant table (ENABLE + FORCE, NULLIF-based tenant policy).
ALTER TABLE "doc_comment_threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "doc_comment_threads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "doc_comment_threads_tenant_isolation" ON "doc_comment_threads"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "doc_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "doc_comments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "doc_comments_tenant_isolation" ON "doc_comments"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Resolving/reopening a thread and "deleting" a comment are both UPDATEs (status/resolved_*, deleted_at
-- soft delete — SDD-008: a thread must stay visible even once a comment in it is "deleted"), never a real
-- DELETE.
GRANT SELECT, INSERT, UPDATE ON TABLE "doc_comment_threads" TO prdm_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE "doc_comment_threads" FROM prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "doc_comments" TO prdm_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE "doc_comments" FROM prdm_app;