CREATE TYPE "group_role" AS ENUM('owner', 'member');--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_create';--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_join';--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_leave';--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_rename';--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_delete';--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_reset_invite';--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_remove_member';--> statement-breakpoint
ALTER TYPE "action_type" ADD VALUE 'group_set_nickname';--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid,
	"user_id" text,
	"role" "group_role" NOT NULL,
	"nickname" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_pkey" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"invite_code" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_lookup_limits" (
	"user_id" text PRIMARY KEY,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "group_name" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "actions" ALTER COLUMN "movie_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "group_members_user_id_idx" ON "group_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_nickname_key" ON "group_members" ("group_id",lower("nickname"));--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_one_owner_key" ON "group_members" ("group_id") WHERE "role" = 'owner';--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invite_lookup_limits" ADD CONSTRAINT "invite_lookup_limits_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;