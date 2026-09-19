ALTER TABLE "agent_messages" ADD COLUMN "tool_ok" boolean;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "finish_reason" text;