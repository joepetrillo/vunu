ALTER TABLE "movies" ADD COLUMN "details_synced_at" timestamp with time zone;--> statement-breakpoint
-- Every movie so far came from the seed, which fetched full details.
UPDATE "movies" SET "details_synced_at" = "synced_at";
