CREATE TABLE "user_work_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"profile" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_work_profile_profile_check" CHECK ("user_work_profile"."profile" IN ('negocio', 'producto', 'developer'))
);
--> statement-breakpoint
ALTER TABLE "user_work_profile" ADD CONSTRAINT "user_work_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Hand-appended, like 0000: `user_work_profile` is a global table 1:1 with `user`, NOT tenant data, so it
-- deliberately has no org_id and no row-level security (same reasoning as `user_profile`: the work profile
-- is a routing preference, not a permission -- PRD-033 R1). prdm_app needs SELECT to read it and
-- INSERT + UPDATE for the idempotent upsert. No DELETE: the row leaves only through the user's own cascade.
GRANT SELECT, INSERT, UPDATE ON TABLE "user_work_profile" TO prdm_app;
