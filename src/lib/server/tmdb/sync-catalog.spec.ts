import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "#lib/server/db/client.ts";
import { movies } from "#lib/server/db/schema.ts";
import { testDatabaseUrl } from "#lib/server/testing/environment.ts";

import type { DiscoverQuery, TmdbClient } from "./client.ts";
import type { TmdbDiscoveredMovie, TmdbMovieDetails } from "./schemas.ts";
import {
  CATALOG_MIN_VOTES,
  REFRESH_SHARE,
  syncCatalog,
  withCatalogLock,
} from "./sync-catalog.ts";

// The sync reads and writes the whole catalog, so it runs against private
// copies of the catalog tables in their own schema, where other test files'
// movies can't appear. Unqualified table names resolve through search_path.
const schema = `sync_test_${randomUUID().replaceAll("-", "")}`;
const admin = createDb(testDatabaseUrl(), 1);
await admin.db.execute(
  sql.raw(`
    CREATE SCHEMA ${schema};
    CREATE TABLE ${schema}.movies (LIKE public.movies INCLUDING ALL);
    CREATE TABLE ${schema}.genres (LIKE public.genres INCLUDING ALL);
    CREATE TABLE ${schema}.movie_genres (LIKE public.movie_genres INCLUDING ALL);
  `)
);
const url = new URL(testDatabaseUrl());
url.searchParams.set("options", `-c search_path=${schema}`);
// Three: the lock test holds one connection while a sync uses the others.
const { pool, db } = createDb(url.toString(), 3);

afterAll(async () => {
  await pool.end();
  await admin.db.execute(sql.raw(`DROP SCHEMA ${schema} CASCADE`));
  await admin.pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE movies, genres, movie_genres`);
});

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-18T09:00:00Z");

interface FakeMovie {
  id: number;
  title: string;
  release_date: string;
  vote_count: number;
  vote_average: number;
}

/**
 * An in-memory TMDB. `pageSize` makes the 500-page limit reachable with a
 * few hundred movies; `detailsFail` decides which detail requests throw.
 */
function fakeTmdb(
  catalog: FakeMovie[],
  options: {
    pageSize?: number;
    gone?: Set<number>;
    detailsFail?: (id: number) => boolean;
  } = {}
) {
  const {
    pageSize = 20,
    gone = new Set(),
    detailsFail = () => false,
  } = options;
  const calls = { discover: [] as DiscoverQuery[], details: [] as number[] };
  const tmdb: Pick<TmdbClient, "genres" | "discover" | "movieDetails"> = {
    genres: () => Promise.resolve({ genres: [{ id: 28, name: "Action" }] }),
    discover: (query) => {
      calls.discover.push(query);
      const matching = catalog
        .filter(
          (movie) =>
            movie.vote_count >= query.minVotes &&
            movie.release_date >= query.from &&
            movie.release_date <= query.to
        )
        .sort((a, b) => a.title.localeCompare(b.title));
      const start = (query.page - 1) * pageSize;
      const results: TmdbDiscoveredMovie[] = matching.slice(
        start,
        start + pageSize
      );
      return Promise.resolve({
        page: query.page,
        total_pages: Math.ceil(matching.length / pageSize),
        total_results: matching.length,
        results,
      });
    },
    movieDetails: (id) => {
      calls.details.push(id);
      if (detailsFail(id)) return Promise.reject(new Error("TMDB is down"));
      const movie = catalog.find((m) => m.id === id);
      if (movie === undefined || gone.has(id)) return Promise.resolve(null);
      const details: TmdbMovieDetails = {
        ...movie,
        runtime: 100,
        genres: [{ id: 28, name: "Action" }],
        poster_path: "/poster.jpg",
        imdb_id: null,
        release_dates: {
          results: [
            {
              iso_3166_1: "US",
              release_dates: [
                {
                  certification: "PG",
                  release_date: `${movie.release_date}T00:00:00.000Z`,
                  type: 3,
                },
              ],
            },
          ],
        },
      };
      return Promise.resolve(details);
    },
  };
  return { tmdb, calls };
}

/** Movie `id`, released in 2000–2001. */
function fakeMovie(id: number, votes = 1000): FakeMovie {
  return {
    id,
    title: `Movie ${String(id).padStart(4, "0")}`,
    release_date: new Date(Date.UTC(2000, 0, 1) + ((id - 1) % 700) * DAY)
      .toISOString()
      .slice(0, 10),
    vote_count: votes,
    vote_average: 7,
  };
}

function makeCatalog(count: number): FakeMovie[] {
  return Array.from({ length: count }, (_, i) => fakeMovie(i + 1));
}

describe("catalog sync", () => {
  it("loads every movie above the catalog floor, splitting ranges past 500 pages", async () => {
    const catalog = [
      ...makeCatalog(600),
      fakeMovie(9999, CATALOG_MIN_VOTES - 1),
    ];
    // One movie per page, so 600 movies is more than one query can serve.
    const { tmdb, calls } = fakeTmdb(catalog, { pageSize: 1 });

    const report = await syncCatalog({ db, tmdb, now });

    expect(report).toEqual({
      discovered: 600,
      newMovies: 600,
      detailed: 600,
      gone: 0,
      failed: 0,
    });
    const firstPages = calls.discover.filter((query) => query.page === 1);
    expect(firstPages.length).toBeGreaterThan(1);
    // Each page was requested once: the measuring request is reused.
    const keys = calls.discover.map(
      (q) => `${q.from}/${q.to}/${String(q.page)}`
    );
    expect(new Set(keys).size).toBe(keys.length);
    const row = await db.query.movies.findFirst({
      where: { id: 1 },
      with: { genres: true },
    });
    expect(row).toMatchObject({
      usReleaseDate: "2000-01-01",
      runtime: 100,
      usCertification: "PG",
      detailsSyncedAt: now,
    });
    expect(row?.genres.map((g) => g.id)).toEqual([28]);
    expect(await db.$count(movies)).toBe(600);
  });

  it("refreshes votes from discovery and skips details fetched today", async () => {
    const catalog = makeCatalog(30);
    await syncCatalog({ db, tmdb: fakeTmdb(catalog).tmdb, now });

    const later = new Date(now.getTime() + 60 * 60 * 1000);
    catalog[0] = { ...fakeMovie(1), vote_count: 5000, vote_average: 8.5 };
    catalog.push(fakeMovie(31));
    const { tmdb, calls } = fakeTmdb(catalog);
    const report = await syncCatalog({ db, tmdb, now: later });

    expect(report).toMatchObject({ discovered: 31, newMovies: 1, detailed: 1 });
    // Only the new movie needed details.
    expect(calls.details).toEqual([31]);
    const row = await db.query.movies.findFirst({ where: { id: 1 } });
    // Discovery only touches votes; the details stay as fetched.
    expect(row).toMatchObject({
      voteCount: 5000,
      voteAverage: 8.5,
      syncedAt: later,
      detailsSyncedAt: now,
      runtime: 100,
      usReleaseDate: "2000-01-01",
    });
  });

  it("resumes an interrupted run where it stopped", async () => {
    const catalog = makeCatalog(250);
    // TMDB fails for good partway through: the run gives up after 20 failures.
    let served = 0;
    const broken = fakeTmdb(catalog, {
      detailsFail: () => ++served > 120,
    });
    await expect(syncCatalog({ db, tmdb: broken.tmdb, now })).rejects.toThrow(
      /Stopped after 20 failed movies/
    );
    const saved = await db.$count(
      movies,
      sql`${movies.detailsSyncedAt} IS NOT NULL`
    );
    // Whole batches of 100 are saved; the batch that hit the failures isn't.
    expect(saved).toBe(100);

    const { tmdb, calls } = fakeTmdb(catalog);
    const report = await syncCatalog({ db, tmdb, now });
    expect(report).toMatchObject({ detailed: 150, failed: 0 });
    expect(calls.details).toHaveLength(150);
    expect(
      await db.$count(movies, sql`${movies.detailsSyncedAt} IS NULL`)
    ).toBe(0);
  });

  it("keeps going past one bad movie, then fails the run so it alerts", async () => {
    const catalog = makeCatalog(10);
    const { tmdb } = fakeTmdb(catalog, { detailsFail: (id) => id === 4 });
    await expect(syncCatalog({ db, tmdb, now })).rejects.toThrow(
      "Details failed for 1 movie; everything else was saved."
    );
    const bad = await db.query.movies.findFirst({ where: { id: 4 } });
    // Discovered but never dealt: no US release date without details.
    expect(bad).toMatchObject({ detailsSyncedAt: null, usReleaseDate: null });
    expect(
      await db.$count(movies, sql`${movies.detailsSyncedAt} IS NOT NULL`)
    ).toBe(9);
  });

  it("refreshes the stalest share of the catalog's details each run", async () => {
    const catalog = makeCatalog(70);
    await syncCatalog({ db, tmdb: fakeTmdb(catalog).tmdb, now });
    // Movie N was last detailed N days ago.
    await db.execute(
      sql`UPDATE movies SET details_synced_at = ${now}::timestamptz - make_interval(days => id)`
    );

    const { tmdb, calls } = fakeTmdb(catalog);
    await syncCatalog({ db, tmdb, now });

    const share = Math.ceil(70 / REFRESH_SHARE);
    expect(calls.details.toSorted((a, b) => b - a)).toEqual(
      Array.from({ length: share }, (_, i) => 70 - i)
    );
  });

  it("keeps a movie TMDB removed and stops asking for it", async () => {
    const catalog = makeCatalog(5);
    const { tmdb } = fakeTmdb(catalog, { gone: new Set([2]) });
    const report = await syncCatalog({ db, tmdb, now });
    expect(report).toMatchObject({ detailed: 4, gone: 1 });
    const row = await db.query.movies.findFirst({ where: { id: 2 } });
    expect(row?.detailsSyncedAt).toEqual(now);

    const again = fakeTmdb(catalog, { gone: new Set([2]) });
    await syncCatalog({ db, tmdb: again.tmdb, now });
    expect(again.calls.details).toEqual([]);
  });

  it("refuses to call an empty discovery a success", async () => {
    await expect(
      syncCatalog({ db, tmdb: fakeTmdb([]).tmdb, now })
    ).rejects.toThrow("TMDB discovered no movies; catalog unchanged.");
  });

  it("lets only one sync run at a time per database", async () => {
    let inner: unknown = "not run";
    const outer = await withCatalogLock(pool, async () => {
      inner = await withCatalogLock(pool, () => Promise.resolve("ran"));
      return "ran";
    });
    expect(outer).toBe("ran");
    expect(inner).toBeNull();
    // Released afterwards.
    expect(await withCatalogLock(pool, () => Promise.resolve("ran"))).toBe(
      "ran"
    );
  });
});
