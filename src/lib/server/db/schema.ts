import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Our copy of the TMDB catalog. The deck is dealt from here; TMDB is never
// called during a user session.
export const movies = pgTable("movies", {
  // TMDB's ID, not a generated one: re-syncing the same movie updates its row
  // instead of creating a duplicate.
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  // TMDB's primary release date; the displayed year comes from it.
  // `mode: "string"` keeps it as "YYYY-MM-DD" so time zones can't shift the day.
  releaseDate: date("release_date", { mode: "string" }),
  // Earliest US release. Null means no known US release, so it's never dealt.
  usReleaseDate: date("us_release_date", { mode: "string" }),
  runtime: integer("runtime"),
  usCertification: text("us_certification"),
  voteAverage: real("vote_average"),
  voteCount: integer("vote_count").notNull(),
  posterPath: text("poster_path"),
  imdbId: text("imdb_id"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
});

export const genres = pgTable("genres", {
  // TMDB's genre ID.
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

export const movieGenres = pgTable(
  "movie_genres",
  {
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id, { onDelete: "cascade" }),
    genreId: integer("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  // The primary key (movie, genre) already serves lookups by movie; the genre
  // filter needs its own index to go the other way.
  (t) => [
    primaryKey({ columns: [t.movieId, t.genreId] }),
    index("movie_genres_genre_id_idx").on(t.genreId),
  ]
);

export type NewMovie = typeof movies.$inferInsert;

// Better Auth's tables, from `bunx auth generate` (Better Auth 1.7, email OTP
// plugin, database rate limits, `usePlural`). Better Auth reads and writes
// them; our code only references `users`. Re-run the generator after changing
// auth plugins or options, and compare. Timestamps are `timestamptz` like ours
// (the generator emits plain `timestamp`).
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  // Ours, not Better Auth's. Bumped by every change to the user's seen list
  // (#lib/server/seen-list.ts), so polling can tell when it changed.
  seenVersion: integer("seen_version").default(0).notNull(),
});

// Login sessions (the cookie points at a row here). Not to be confused with
// watch sessions, the group movie-finding sessions.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)]
);

// Linked sign-in methods (OAuth providers, passwords). Email codes don't use
// it, but Better Auth requires the table.
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)]
);

// Pending sign-in codes, keyed by `identifier` (e.g. "sign-in-otp-<email>").
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)]
);

// Request counters per IP and path. In memory they'd reset on every
// serverless instance, so they live here.
export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  // Milliseconds since the epoch, as Better Auth writes it.
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export type User = typeof users.$inferSelect;

// Our own per-address limit on sign-in code emails (see
// #lib/server/sign-in-code-limit.ts). Better Auth's rate limits are per IP,
// and people in one room share an IP. One row per address ever used.
export const signInCodeLimits = pgTable("sign_in_code_limits", {
  email: text("email").primaryKey(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
  count: integer("count").notNull(),
});

// Each user's seen list: one row per movie they've seen. Only "seen" is ever
// stored; a missing row means unknown, never "not seen". Changed only through
// #lib/server/seen-list.ts.
export const seenMovies = pgTable(
  "seen_movies",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // No cascade: deleting a catalog movie must never silently erase
    // someone's seen entry, so such a delete fails instead.
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // Also the index for "this user's seen movies", since user_id comes first.
  (t) => [primaryKey({ columns: [t.userId, t.movieId] })]
);

// A group of people who find movies together. Changed only through
// #lib/server/groups.ts, which locks the group's row for every membership
// change so concurrent joins, leaves, and deletes queue instead of racing.
export const groups = pgTable("groups", {
  // Generated by the browser along with the action ID, so a retried "create"
  // names the same group and lands on it (see groups.ts).
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  // The group's one invite, shared as a code or as /join/<code>. It never
  // expires; the owner's reset replaces it, which kills the old one.
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const groupRole = pgEnum("group_role", ["owner", "member"]);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: groupRole("role").notNull(),
    // What the group calls this person. Per group, so emails never show.
    nickname: text("nickname").notNull(),
    // Decides who becomes owner when the owner leaves (longest-standing).
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Also serves "this group's members", since group_id comes first.
    primaryKey({ columns: [t.groupId, t.userId] }),
    // "My groups" goes the other way.
    index("group_members_user_id_idx").on(t.userId),
    // "Sam" and "sam" can't share a group: names must tell people apart.
    uniqueIndex("group_members_nickname_key").on(
      t.groupId,
      sql`lower(${t.nickname})`
    ),
    // A partial index: it only covers owner rows, so a group can have many
    // members but at most one owner.
    uniqueIndex("group_members_one_owner_key")
      .on(t.groupId)
      .where(sql`${t.role} = 'owner'`),
  ]
);

// Per-user limit on invite code lookups (see #lib/server/groups.ts). Codes are
// short and never expire, so this is what makes guessing one impractical.
export const inviteLookupLimits = pgTable("invite_lookup_limits", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
  count: integer("count").notNull(),
});

// Grows with each stage that adds a kind of change (answers, undo, …).
export const actionType = pgEnum("action_type", [
  "seen_list_add",
  "seen_list_remove",
  "group_create",
  "group_join",
  "group_leave",
  "group_rename",
  "group_delete",
  "group_reset_invite",
  "group_remove_member",
  "group_set_nickname",
]);

// Every change a user makes, keyed by an ID the browser generates. A retried
// request carries the same ID, so the server recognizes it and changes nothing
// (see #lib/server/actions.ts). Later stages also use it for undo.
export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: actionType("type").notNull(),
    // The action's input, one typed column per kind of value. Each type uses
    // the ones it needs and leaves the rest null; a retry must match all of
    // them (see actions.ts).
    movieId: integer("movie_id").references(() => movies.id),
    // No foreign keys from here on: the log outlives a deleted group or a
    // removed member, so a retried delete is still recognized.
    groupId: uuid("group_id"),
    memberId: text("member_id"),
    groupName: text("group_name"),
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // Postgres doesn't index foreign keys by itself; deleting a user needs this
  // to find their actions.
  (t) => [index("actions_user_id_idx").on(t.userId)]
);

export type ActionType = (typeof actionType.enumValues)[number];
