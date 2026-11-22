ALTER TABLE "commits" ADD COLUMN "parents" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "project_code_state" ADD COLUMN "latest_baseline_branch" text;--> statement-breakpoint
ALTER TABLE "project_code_state" ADD COLUMN "latest_baseline_reported_at" timestamp with time zone;