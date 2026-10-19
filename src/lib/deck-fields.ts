import { z } from "zod";

import { joinDetails, NO_BREAK_SPACE } from "#lib/format.ts";

// Rules for the group deck's preferences, cards, and replies. Shared by the
// server (which validates) and the pages (which offer the same choices and
// describe them).

/** Offered as "Up to 1 h 30 min", etc. Any whole number up to the max is valid. */
export const RUNTIME_CHOICES = [90, 120, 150] as const;
export const RUNTIME_MAX = 600;
export const YEAR_MIN = 1870;
export const YEAR_MAX = 2100;

/** TMDB's Animation genre. It has its own field, so it isn't a genre chip. */
export const ANIMATION_GENRE_ID = 16;

/** Any, no animated movies, or only animated movies. */
export const ANIMATION_CHOICES = ["any", "exclude", "only"] as const;
export type Animation = (typeof ANIMATION_CHOICES)[number];

/**
 * US age ratings people can pick, in the order they're offered. R includes
 * NC-17 (rare, and few people know it); NR is everything else, unknown
 * included.
 */
export const RATINGS = ["G", "PG", "PG-13", "R", "NR"] as const;
export type Rating = (typeof RATINGS)[number];

export function ratingLabel(rating: Rating): string {
  return rating === "NR" ? "Not rated" : rating;
}

/**
 * What one person is in the mood for tonight. Personal and per visit: they
 * live in the deck's URL, never in the database, and pick only the new
 * movies dealt to you (movies the group already started reach everyone).
 */
export interface Preferences {
  maxRuntime: number | null;
  minYear: number | null;
  maxYear: number | null;
  /** Any of these; empty means every genre. Sorted, no duplicates. */
  genreIds: number[];
  animation: Animation;
  /** Any of these; empty means every rating. In RATINGS order. */
  ratings: Rating[];
}

export const NO_PREFERENCES: Preferences = {
  maxRuntime: null,
  minYear: null,
  maxYear: null,
  genreIds: [],
  animation: "any",
  ratings: [],
};

// An empty field ("Any") means no limit. Out-of-range values get a message
// written for people (readForm shows it).
function optionalWholeNumber(min: number, max: number, label: string) {
  const error = `Pick a ${label} between ${String(min)} and ${String(max)}.`;
  return z
    .union([z.literal("").transform(() => null), z.coerce.number()])
    .pipe(z.int({ error }).min(min, { error }).max(max, { error }).nullable());
}

/**
 * A checkbox list's values (genres, ratings). Each ticked box sends the name
 * once, so it arrives as nothing, one value, or a list.
 */
function ticked<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .default([])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .pipe(z.array(item).max(50));
}

/** The preference fields, as a form or the deck's URL query sends them. */
export const preferencesSchema = z
  .object({
    maxRuntime: optionalWholeNumber(
      1,
      RUNTIME_MAX,
      "length in minutes"
    ).default(null),
    minYear: optionalWholeNumber(YEAR_MIN, YEAR_MAX, "year").default(null),
    maxYear: optionalWholeNumber(YEAR_MIN, YEAR_MAX, "year").default(null),
    // Sorted and deduplicated, so the same choice always compares equal
    // (and makes the same URL).
    genreIds: ticked(
      z.string().transform(Number).pipe(z.int().positive())
    ).transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
    // "Any" is the empty radio button.
    animation: z
      .enum(["", ...ANIMATION_CHOICES])
      .default("any")
      .transform((value) => (value === "" ? "any" : value)),
    ratings: ticked(z.enum(RATINGS)).transform((picked) =>
      RATINGS.filter((rating) => picked.includes(rating))
    ),
  })
  .refine(
    ({ minYear, maxYear }) =>
      minYear === null || maxYear === null || minYear <= maxYear,
    { error: "The first year must come before the last." }
  );

/**
 * The preferences in a deck URL's query. Anything invalid (an edited or old
 * link) means no preferences rather than an error page: they only pick new
 * movies, so the deck still works.
 */
export function preferencesFromQuery(query: URLSearchParams): Preferences {
  const parsed = preferencesSchema.safeParse({
    maxRuntime: query.get("maxRuntime") ?? undefined,
    minYear: query.get("minYear") ?? undefined,
    maxYear: query.get("maxYear") ?? undefined,
    genreIds: query.getAll("genreIds"),
    animation: query.get("animation") ?? undefined,
    ratings: query.getAll("ratings"),
  });
  return parsed.success ? parsed.data : NO_PREFERENCES;
}

/** The query string for these preferences (empty for none), without the "?". */
export function preferencesToQuery(preferences: Preferences): string {
  const query = new URLSearchParams();
  const { maxRuntime, minYear, maxYear, genreIds, animation, ratings } =
    preferences;
  if (maxRuntime !== null) query.set("maxRuntime", String(maxRuntime));
  if (minYear !== null) query.set("minYear", String(minYear));
  if (maxYear !== null) query.set("maxYear", String(maxYear));
  for (const id of genreIds) query.append("genreIds", String(id));
  if (animation !== "any") query.set("animation", animation);
  for (const rating of ratings) query.append("ratings", rating);
  return query.toString();
}

export function hasPreferences(preferences: Preferences): boolean {
  const { maxRuntime, minYear, maxYear, genreIds, animation, ratings } =
    preferences;
  return (
    maxRuntime !== null ||
    minYear !== null ||
    maxYear !== null ||
    genreIds.length > 0 ||
    animation !== "any" ||
    ratings.length > 0
  );
}

/**
 * How many kinds of preference are set (genres count once), for the deck's
 * "In the mood for" button. 0 means anything.
 */
export function countPreferences(preferences: Preferences): number {
  const { maxRuntime, minYear, maxYear, genreIds, animation, ratings } =
    preferences;
  return [
    genreIds.length > 0,
    animation !== "any",
    ratings.length > 0,
    maxRuntime !== null,
    minYear !== null || maxYear !== null,
  ].filter(Boolean).length;
}

/** 135 → "2 h 15 min". */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0
    ? `${String(hours)} h`
    : `${String(hours)} h ${String(rest)} min`;
}

/** A movie as the deck and match lists show it. */
export const movieCardSchema = z.object({
  id: z.int(),
  title: z.string(),
  year: z.int().nullable(),
  runtime: z.int().nullable(),
  posterPath: z.string().nullable(),
  genres: z.array(z.string()),
});
export type MovieCard = z.infer<typeof movieCardSchema>;

/** "1999 · 2 h 15 min · Drama, Comedy": the line under a movie's title. */
export function describeMovie(movie: MovieCard): string {
  return joinDetails([
    movie.year === null ? null : String(movie.year),
    // "2 h 15 min" stays on one line too.
    movie.runtime === null
      ? null
      : formatRuntime(movie.runtime).replaceAll(" ", NO_BREAK_SPACE),
    movie.genres.slice(0, 3).join(", ") || null,
  ]);
}

/** TMDB's US watch page: where TMDB lists streaming, rental, and purchase. */
export function whereToWatchUrl(movieId: number): string {
  return `https://www.themoviedb.org/movie/${String(movieId)}/watch?locale=US`;
}

/** At this many matches the deck suggests reviewing them. */
export const REVIEW_PROMPT_AT = 5;

/**
 * What the group deck shows, read at one moment (one database snapshot), so
 * the fingerprint describes exactly these cards and counts. A schema because
 * the poll's reply arrives as JSON the browser checks.
 */
export const deckStateSchema = z.object({
  /** The top cards to deal, skipping what the browser already holds. */
  cards: z.array(movieCardSchema),
  matchCount: z.int(),
  canUndo: z.boolean(),
  /** Changes whenever anything the deck shows could have (spec section 5). */
  fingerprint: z.string(),
  /**
   * Set only when you have nothing left to answer: the nicknames of the
   * members who haven't answered movies you said Not seen to, so your
   * matches wait on them. Empty: nobody (your preferences used up the pool).
   */
  waitingOn: z.array(z.string()).nullable(),
});
export type DeckState = z.infer<typeof deckStateSchema>;

/** The poll's reply. */
export const pollReplySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unchanged") }),
  z.object({ status: z.literal("changed"), state: deckStateSchema }),
  // You're no longer in the group: the page reloads (and gets a 404).
  z.object({ status: z.literal("ended") }),
]);
export type PollReply = z.infer<typeof pollReplySchema>;
