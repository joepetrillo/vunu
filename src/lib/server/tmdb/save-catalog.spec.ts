import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { genres, movies } from "#lib/server/db/schema.ts";
import { connectTestDb, testMovieId } from "#lib/server/testing/db.ts";

import { saveCatalog } from "./save-catalog.ts";
import type { TmdbMovieDetails } from "./schemas.ts";

const { pool, db } = connectTestDb();
const movieIds: number[] = [];
const genreIds: number[] = [];
const syncedAt = new Date();

function details(overrides: Partial<TmdbMovieDetails> = {}): TmdbMovieDetails {
  const id = testMovieId();
  movieIds.push(id);
  return {
    id,
    title: `Audit movie ${String(id)}`,
    release_date: "2000-01-01",
    runtime: 100,
    genres: [],
    vote_average: 7,
    vote_count: 100,
    poster_path: null,
    imdb_id: null,
    release_dates: { results: [] },
    ...overrides,
  };
}
function genre() {
  const id = testMovieId();
  genreIds.push(id);
  return { id, name: `Audit genre ${String(id)}` };
}

afterAll(async () => {
  if (movieIds.length > 0)
    await db.delete(movies).where(inArray(movies.id, movieIds));
  if (genreIds.length > 0)
    await db.delete(genres).where(inArray(genres.id, genreIds));
  await pool.end();
});

describe("transactional catalog persistence", () => {
  it("handles an empty batch and valid movies with no genres", async () => {
    expect(await saveCatalog(db, { genres: [], movies: [], syncedAt })).toEqual(
      { inserted: 0, updated: 0 }
    );
    const movie = details();
    expect(
      await saveCatalog(db, { genres: [], movies: [movie], syncedAt })
    ).toEqual({ inserted: 1, updated: 0 });
    const row = await db.query.movies.findFirst({
      where: { id: movie.id },
      with: { genres: true },
    });
    expect(row?.title).toBe(movie.title);
    expect(row?.genres).toEqual([]);
  });

  it("updates in place and replaces/clears genres without creating duplicates", async () => {
    const first = genre();
    const second = genre();
    const movie = details({ genres: [first, first] });
    expect(
      await saveCatalog(db, { genres: [], movies: [movie], syncedAt })
    ).toEqual({ inserted: 1, updated: 0 });
    const updated = {
      ...movie,
      title: "Updated audit movie",
      genres: [second],
    };
    expect(
      await saveCatalog(db, { genres: [], movies: [updated], syncedAt })
    ).toEqual({ inserted: 0, updated: 1 });
    const row = await db.query.movies.findFirst({
      where: { id: movie.id },
      with: { genres: true },
    });
    expect(row?.title).toBe("Updated audit movie");
    expect(row?.genres.map((item) => item.id)).toEqual([second.id]);
    await saveCatalog(db, {
      genres: [],
      movies: [{ ...updated, genres: [] }],
      syncedAt,
    });
    const cleared = await db.query.movies.findFirst({
      where: { id: movie.id },
      with: { genres: true },
    });
    expect(cleared?.genres).toEqual([]);
  });

  it("rolls back genres and all movies if one SQL write fails", async () => {
    const item = genre();
    const valid = details({ genres: [item] });
    // Fault injection beyond the provider validator: PostgreSQL rejects this date.
    const invalid = details({ release_date: "2026-02-30" });
    await expect(
      saveCatalog(db, { genres: [item], movies: [valid, invalid], syncedAt })
    ).rejects.toThrow();
    expect(
      await db.query.genres.findFirst({ where: { id: item.id } })
    ).toBeUndefined();
    expect(
      await db.query.movies.findFirst({ where: { id: valid.id } })
    ).toBeUndefined();
  });
});
