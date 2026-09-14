CREATE TABLE "oidc_used_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Deliberately no RLS (SDD-010 / WO-179): see `packages/db/src/schema/oidc.ts`'s module doc comment —
-- same reasoning as `llm_global_usage`'s own exclusion. `prdm_app` needs INSERT (claiming a `jti` the
-- first time it's seen) and SELECT (the ON CONFLICT DO NOTHING round trip); no UPDATE/DELETE, since a
-- claimed row is never modified.
GRANT SELECT, INSERT ON TABLE "oidc_used_jtis" TO prdm_app;
