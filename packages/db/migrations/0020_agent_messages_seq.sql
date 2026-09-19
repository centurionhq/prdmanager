-- WO-468 (SDD-035/PRD-016): `agent_messages.seq`, the transcript's real order.
--
-- Hand-adjusted from what `drizzle-kit generate` produced, which was a single
-- `ADD COLUMN "seq" integer NOT NULL` — correct against an empty table and a guaranteed failure against
-- any database that already holds a conversation. Split into the usual three steps instead: add it
-- nullable, backfill it, then make it NOT NULL.

ALTER TABLE "agent_messages" ADD COLUMN "seq" integer;--> statement-breakpoint

-- The table is `FORCE ROW LEVEL SECURITY`, so its tenant policy applies to prdm_owner (the migration
-- role and the table's owner) exactly as it does to prdm_app. `app.org_id` is unset here, so the policy
-- would match no rows and the backfill would silently update nothing, leaving every existing row NULL
-- and the SET NOT NULL below failing. Turned off only for the backfill, and turned straight back on --
-- the whole migration file runs in one transaction, so no other session ever sees it off.
ALTER TABLE "agent_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Deterministic and stable, but only an approximation of the truth for rows written before this
-- migration: every message a single turn produced shares one `created_at` (that is the bug), so their
-- real order is unrecoverable and `id` only breaks the tie reproducibly. Accepted in PRD-016 §Riesgos --
-- the true order is guaranteed from here forward, not retroactively.
UPDATE "agent_messages" AS m
SET "seq" = ordered.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "conversation_id" ORDER BY "created_at", "id") AS rn
  FROM "agent_messages"
) AS ordered
WHERE m."id" = ordered."id";--> statement-breakpoint

ALTER TABLE "agent_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "agent_messages" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint

-- Two messages of one conversation can never claim the same position. This is also what makes the
-- server-side assignment safe under concurrency: a racing turn collides here instead of quietly
-- producing a duplicate rank.
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_seq_uq" UNIQUE("conversation_id","seq");
