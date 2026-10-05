import { inArray, sql } from "drizzle-orm";

import type { Db } from "#lib/server/db/client.ts";
import { genres, movieGenres, movies } from "#lib/server/db/schema.ts";

import type { TmdbGenre, TmdbMovieDetails } from "./schemas.ts";
import { toMovieRow } from "./to-movie-row.ts";

/** Persists one validated provider batch atomically; safe to re-run. */
export async function saveCatalog(
  db: Db,
  batch: { genres: TmdbGenre[]; movies: TmdbMovieDetails[]; syncedAt: Date }
): Promise<{ inserted: number; updated: number }> {
  if (batch.movies.length === 0) return { inserted: 0, updated: 0 };
  const rows = batch.movies.map((details) =>
    toMovieRow(details, batch.syncedAt)
  );
  // Include movie-specific genres if the provider's master list lags behind.
  const allGenres = new Map<number, TmdbGenre>();
  for (const genre of [
    ...batch.genres,
    ...batch.movies.flatMap((movie) => movie.genres),
  ]) {
    allGenres.set(genre.id, genre);
  }

  const upserted = await db.transaction(async (tx) => {
    if (allGenres.size > 0) {
      await tx
        .insert(genres)
        .values([...allGenres.values()])
        .onConflictDoUpdate({
          target: genres.id,
          set: { name: sql.raw(`excluded.${genres.name.name}`) },
        });
    }

    const result = await tx
      .insert(movies)
      .values(rows.map((row) => row.movie))
      .onConflictDoUpdate({
        target: movies.id,
        // These SQL fragments contain only our column names, never provider data.
        set: {
          title: sql.raw(`excluded.${movies.title.name}`),
          releaseDate: sql.raw(`excluded.${movies.releaseDate.name}`),
          usReleaseDate: sql.raw(`excluded.${movies.usReleaseDate.name}`),
          runtime: sql.raw(`excluded.${movies.runtime.name}`),
          usCertification: sql.raw(`excluded.${movies.usCertification.name}`),
          voteAverage: sql.raw(`excluded.${movies.voteAverage.name}`),
          voteCount: sql.raw(`excluded.${movies.voteCount.name}`),
          posterPath: sql.raw(`excluded.${movies.posterPath.name}`),
          imdbId: sql.raw(`excluded.${movies.imdbId.name}`),
          syncedAt: sql.raw(`excluded.${movies.syncedAt.name}`),
        },
      })
      // PostgreSQL returns xmax=0 for this statement's inserts, so seeding can
      // report inserts separately from updates without another read/race.
      .returning({ inserted: sql<boolean>`xmax = 0` });

    await tx.delete(movieGenres).where(
      inArray(
        movieGenres.movieId,
        rows.map((row) => row.movie.id)
      )
    );
    const links = rows.flatMap((row) =>
      row.genreIds.map((genreId) => ({ movieId: row.movie.id, genreId }))
    );
    // A movie can legitimately have no genres. Drizzle rejects values([]).
    if (links.length > 0) await tx.insert(movieGenres).values(links);
    return result;
  });

  const inserted = upserted.filter((row) => row.inserted).length;
  return { inserted, updated: upserted.length - inserted };
}
