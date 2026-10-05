import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  sql,
} from "drizzle-orm";

import type { Db } from "#lib/server/db/client.ts";
import { movieGenres, movies, seenMovies } from "#lib/server/db/schema.ts";

export const PAGE_SIZE = 30;
// OFFSET is calculated in JavaScript before pg receives it. Keep that integer
// exact without choosing an arbitrary cap on how much of the catalog is browsable.
export const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE) + 1;

export interface MovieSearch {
  /** The user's seen list (newest first) or the whole catalog (most-voted first). */
  scope: "mine" | "all";
  /** Matches anywhere in the title, ignoring case. Empty matches everything. */
  title: string;
  genre?: number | undefined;
  /** A decade's first year (1990 for the 1990s), by primary release date. */
  decade?: number | undefined;
  /** Starts at 1. */
  page: number;
}

export interface MovieSearchResult {
  id: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  /** Whether it's on the user's seen list. */
  seen: boolean;
}

/** One page of movies for the seen-movies page. */
export async function searchMovies(
  db: Db,
  userId: string,
  { scope, title, genre, decade, page }: MovieSearch
): Promise<{ movies: MovieSearchResult[]; hasNextPage: boolean }> {
  const rows = await db
    .select({
      id: movies.id,
      title: movies.title,
      year: sql<number | null>`extract(year from ${movies.releaseDate})::int`,
      posterPath: movies.posterPath,
      seen: sql<boolean>`${seenMovies.movieId} is not null`,
    })
    .from(movies)
    // At most one match per movie, since seen_movies is keyed by (user, movie).
    .leftJoin(
      seenMovies,
      and(eq(seenMovies.movieId, movies.id), eq(seenMovies.userId, userId))
    )
    .where(
      and(
        scope === "mine" ? isNotNull(seenMovies.movieId) : undefined,
        title === ""
          ? undefined
          : ilike(movies.title, `%${escapeLikePattern(title)}%`),
        genre === undefined
          ? undefined
          : inArray(
              movies.id,
              db
                .select({ id: movieGenres.movieId })
                .from(movieGenres)
                .where(eq(movieGenres.genreId, genre))
            ),
        decade === undefined
          ? undefined
          : and(
              gte(movies.releaseDate, `${String(decade)}-01-01`),
              lt(movies.releaseDate, `${String(decade + 10)}-01-01`)
            )
      )
    )
    .orderBy(
      ...(scope === "mine"
        ? [desc(seenMovies.createdAt), asc(movies.id)]
        : [desc(movies.voteCount), asc(movies.id)])
    )
    // One extra row says whether there's a next page, without counting them all.
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);

  return {
    movies: rows.slice(0, PAGE_SIZE),
    hasNextPage: rows.length > PAGE_SIZE,
  };
}

// In LIKE patterns `%` and `_` are wildcards and `\` escapes them. Escaping all
// three makes a search for "100%" match those characters literally.
function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}
