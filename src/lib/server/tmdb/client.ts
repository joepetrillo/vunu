import type { z } from "zod";

import {
  discoverPageSchema,
  genreListSchema,
  movieDetailsSchema,
} from "./schemas.ts";

const BASE_URL = "https://api.themoviedb.org/3";
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_DELAY_MS = 30_000;

// Only sync scripts use this. The app never calls TMDB during a user session.
export function createTmdbClient(readAccessToken: string) {
  /** Fetches and validates one resource; null when TMDB has no such resource. */
  async function find<T extends z.ZodType>(
    path: string,
    params: Record<string, string>,
    schema: T
  ): Promise<z.infer<T> | null> {
    const url = `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`;
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${readAccessToken}`,
          Accept: "application/json",
        },
      });
      if (response.ok) return schema.parse(await response.json());

      // Release the response body/connection before waiting or failing.
      await response.body?.cancel();
      if (response.status === 404) return null;

      // 429 = rate limited, 5xx = TMDB hiccup: both are worth retrying.
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`TMDB ${path} returned ${String(response.status)}`);
      }
      const header = response.headers.get("retry-after");
      const seconds = Number(header);
      // Retry-After permits seconds or an HTTP date. Bound provider-controlled
      // waits; invalid/past values fall back to exponential backoff.
      const requestedDelay =
        Number.isFinite(seconds) && seconds > 0
          ? seconds * 1000
          : header === null
            ? NaN
            : Date.parse(header) - Date.now();
      const delayMs = Math.min(
        requestedDelay > 0 ? requestedDelay : 500 * 2 ** attempt,
        MAX_RETRY_DELAY_MS
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  /** Like `find`, for resources that always exist. */
  async function get<T extends z.ZodType>(
    path: string,
    params: Record<string, string>,
    schema: T
  ): Promise<z.infer<T>> {
    const result = await find(path, params, schema);
    if (result === null) throw new Error(`TMDB ${path} returned 404`);
    return result;
  }

  return {
    genres: () =>
      get("/genre/movie/list", { language: "en-US" }, genreListSchema),

    /**
     * One page of movies with at least `minVotes` votes whose primary release
     * date falls in [from, to] (inclusive "YYYY-MM-DD"). TMDB serves at most
     * 500 pages per query, so callers split ranges until each fits.
     */
    discover: (query: DiscoverQuery) =>
      get(
        "/discover/movie",
        {
          // A sort on values that rarely change, so pages stay stable while
          // we read them (a vote-count sort shifts as people vote).
          sort_by: "original_title.asc",
          "vote_count.gte": String(query.minVotes),
          "primary_release_date.gte": query.from,
          "primary_release_date.lte": query.to,
          include_adult: "false",
          include_video: "false",
          language: "en-US",
          page: String(query.page),
        },
        discoverPageSchema
      ),

    /**
     * Runtime, IMDb ID, genres, and US release info, which discover results
     * lack. Null when TMDB no longer has the movie.
     */
    movieDetails: async (id: number) => {
      const details = await find(
        `/movie/${String(id)}`,
        { language: "en-US", append_to_response: "release_dates" },
        movieDetailsSchema
      );
      if (details !== null && details.id !== id)
        throw new Error("TMDB returned a different movie than requested.");
      return details;
    },
  };
}

export interface DiscoverQuery {
  minVotes: number;
  from: string;
  to: string;
  page: number;
}

export type TmdbClient = ReturnType<typeof createTmdbClient>;
