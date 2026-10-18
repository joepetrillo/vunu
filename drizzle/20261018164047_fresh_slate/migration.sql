-- A one-time fresh start for the group decks, before real users arrive:
-- everyone's Not seen answers, every group's matches and Watched list, and
-- the deck's answer log go. Seen lists, groups, and members stay. A Seen
-- answer's seen entry stays too; with its log entry gone it can no longer
-- be undone from the deck.
DELETE FROM "not_seen_movies";
--> statement-breakpoint
DELETE FROM "group_watched_movies";
--> statement-breakpoint
DELETE FROM "actions" WHERE "type" IN (
  'answer_seen',
  'answer_not_seen',
  'answer_undo',
  'group_mark_watched',
  'group_unmark_watched'
);
--> statement-breakpoint
-- Open decks notice the change on their next poll.
UPDATE "groups" SET "revision" = "revision" + 1;
