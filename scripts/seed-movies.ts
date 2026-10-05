/**
 * Loads the most-voted movies from TMDB into our catalog. Safe to re-run:
 * rows are keyed by TMDB ID and upserted, so a second run updates in place
 * and inserts nothing.
 *
 * Run: `bun run db:seed` (DATABASE_URL from .env.local, so the dev database).
 * Production sync will be added at stage 9; this command is Development only.
 * TMDB_READ_ACCESS_TOKEN is a Development-only Secret on Vercel (the deployed
 * app never calls TMDB), pulled into .env.local with the database URLs.
 */
import { z } from "zod";

import { createDb } from "#lib/server/db/client.ts";
import { genres, movieGenres, movies } from "#lib/server/db/schema.ts";
import { createTmdbClient } from "#lib/server/tmdb/client.ts";
import { saveCatalog } from "#lib/server/tmdb/save-catalog.ts";

// TMDB returns 20 movies per discover page.
const PAGES = 15;
// Parallel detail requests; TMDB allows roughly 50 per second.
const CONCURRENCY = 8;

// Scripts run outside SvelteKit, so src/env.ts doesn't apply; validate here.
const env = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    TMDB_READ_ACCESS_TOKEN: z.string().min(1),
    // This local seed command must never run in a hosted deploy environment.
    VERCEL_ENV: z.literal("development").optional(),
  })
  .parse(process.env);

const tmdb = createTmdbClient(env.TMDB_READ_ACCESS_TOKEN);
const { pool, db } = createDb(env.DATABASE_URL, 1);

/** Runs `fn` over `items` with at most `limit` calls in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      // `index` is always in range here, but noUncheckedIndexedAccess can't know that.
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main(): Promise<void> {
  // Dev and Production are different Neon endpoints; show which one we write to.
  console.log(`Seeding ${new URL(env.DATABASE_URL).hostname}`);
  const { genres: genreList } = await tmdb.genres();

  // Rankings can shift between page requests, so a movie may appear twice.
  const ids = new Set<number>();
  for (let page = 1; page <= PAGES; page++) {
    const { results } = await tmdb.discoverByVoteCount(page);
    for (const { id } of results) ids.add(id);
  }
  console.log(`Discovered ${String(ids.size)} movies; fetching details…`);
  if (ids.size === 0)
    throw new Error("TMDB returned no movies; catalog unchanged.");

  const syncedAt = new Date();
  const detailed = await mapWithConcurrency([...ids], CONCURRENCY, (id) =>
    tmdb.movieDetails(id)
  );
  const { inserted, updated } = await saveCatalog(db, {
    genres: genreList,
    movies: detailed,
    syncedAt,
  });
  const [movieTotal, genreTotal, linkTotal] = await Promise.all([
    db.$count(movies),
    db.$count(genres),
    db.$count(movieGenres),
  ]);
  console.log(
    `Movies: ${String(inserted)} inserted, ${String(updated)} updated.`
  );
  console.log(
    `Totals: ${String(movieTotal)} movies, ${String(genreTotal)} genres, ${String(linkTotal)} movie-genre links.`
  );
}

try {
  await main();
} finally {
  await pool.end();
}
