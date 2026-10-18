-- A one-time fresh start for the group decks, before real users arrive:
-- everyone's Not seen answers and every group's matches and Watched list
-- go. Seen lists, groups, and members stay, including seen entries that
-- came from Seen answers.
DELETE FROM "not_seen_movies";
--> statement-breakpoint
DELETE FROM "group_watched_movies";
--> statement-breakpoint
-- The answers themselves stay logged, so a retry of one sent just before
-- this ran is still recognized and can't bring its row back. Marking them
-- undone (by an ID no browser holds) takes them off every undo stack, and
-- an undo never restores them as a "previous answer".
UPDATE "actions" SET "undone_by_action_id" = gen_random_uuid()
WHERE "type" IN ('answer_seen', 'answer_not_seen')
  AND "undone_by_action_id" IS NULL;
--> statement-breakpoint
-- Open decks notice the change on their next poll.
UPDATE "groups" SET "revision" = "revision" + 1;
