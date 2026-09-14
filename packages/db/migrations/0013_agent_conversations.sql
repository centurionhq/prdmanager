CREATE TYPE "public"."agent_message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."agent_proposal_status" AS ENUM('pending', 'accepted', 'rejected', 'stale');--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_conversations_id_org_id_key" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "agent_message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"tool_name" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_messages_content_length" CHECK (char_length("agent_messages"."content") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "agent_proposal_status" DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"edits" jsonb NOT NULL,
	"fields_set" jsonb,
	"fields_unset" jsonb,
	"requested_by" text NOT NULL,
	"responded_by" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_global_usage" (
	"usage_date" date PRIMARY KEY NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"org_id" text NOT NULL,
	"usage_date" date NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_pkey" PRIMARY KEY("org_id","usage_date")
);
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_document_org_fk" FOREIGN KEY ("document_id","org_id") REFERENCES "public"."documents"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_org_fk" FOREIGN KEY ("conversation_id","org_id") REFERENCES "public"."agent_conversations"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_responded_by_user_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_conversation_org_fk" FOREIGN KEY ("conversation_id","org_id") REFERENCES "public"."agent_conversations"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_document_org_fk" FOREIGN KEY ("document_id","org_id") REFERENCES "public"."documents"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_conversations_org_id_idx" ON "agent_conversations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agent_conversations_document_id_idx" ON "agent_conversations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "agent_conversations_owner_id_idx" ON "agent_conversations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agent_messages_org_id_idx" ON "agent_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agent_messages_conversation_id_idx" ON "agent_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_proposals_org_id_idx" ON "agent_proposals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agent_proposals_conversation_id_idx" ON "agent_proposals" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_proposals_document_id_idx" ON "agent_proposals" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "llm_usage_org_id_idx" ON "llm_usage" USING btree ("org_id");--> statement-breakpoint

-- SDD-009 §Persistencia (WO-168) — hand-appended below drizzle-kit's own output, same shape as every
-- other tenant table (ENABLE + FORCE, NULLIF-based tenant policy). llm_global_usage is deliberately
-- excluded: see packages/db/src/schema/agent.ts's module doc comment for why it has no org_id at all.
ALTER TABLE "agent_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_conversations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agent_conversations_tenant_isolation" ON "agent_conversations"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "agent_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agent_messages_tenant_isolation" ON "agent_messages"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "agent_proposals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_proposals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agent_proposals_tenant_isolation" ON "agent_proposals"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint
ALTER TABLE "llm_usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "llm_usage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "llm_usage_tenant_isolation" ON "llm_usage"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), ''));
--> statement-breakpoint

-- Conversations/proposals/usage counters get SELECT+INSERT+UPDATE (no DELETE — a conversation/proposal is
-- never removed, only its status/updated_at change; a usage counter is only ever upserted). Messages are
-- strictly append-only (SELECT+INSERT — a transcript row, once written, is never edited or removed).
GRANT SELECT, INSERT, UPDATE ON TABLE "agent_conversations" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "agent_messages" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "agent_proposals" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "llm_usage" TO prdm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "llm_global_usage" TO prdm_app;
