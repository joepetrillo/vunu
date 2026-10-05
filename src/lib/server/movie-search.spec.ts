import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { movieGenres, seenMovies } from "#lib/server/db/schema.ts";
import {
  searchMovies,
  type MovieSearch,
  PAGE_SIZE,
} from "#lib/server/movie-search.ts";
import { addToSeenList } from "#lib/server/seen-list.ts";
import { connectTestDb, createFixtures } from "#lib/server/testing/db.ts";

const { pool, db } = connectTestDb();
let fixtures: ReturnType<typeof createFixtures>;
let userId: string;
let prefix: string;

beforeEach(async () => {
  fixtures = createFixtures(db);
  userId = await fixtures.user();
  prefix = crypto.randomUUID();
});
afterEach(async () => {
  await fixtures.cleanUp();
});
afterAll(async () => {
  await pool.end();
});

function search(changes: Partial<MovieSearch> = {}, actingUser = userId) {
  return searchMovies(db, actingUser, {
    scope: "all",
    title: prefix,
    page: 1,
    ...changes,
  });
}
function markSeen(movieId: number, actingUser = userId) {
  return addToSeenList(db, {
    actionId: crypto.randomUUID(),
    userId: actingUser,
    movieId,
  });
}

describe("catalog and seen-list queries", () => {
  it("isolates seen state and seen-list reads by the authenticated user", async () => {
    const movieId = await fixtures.movie({ title: prefix });
    const otherUser = await fixtures.user();
    await markSeen(movieId, otherUser);

    expect((await search({ scope: "mine" })).movies).toEqual([]);
    expect((await search()).movies.map((movie) => movie.seen)).toEqual([false]);
    expect(
      (await search({ scope: "mine" }, otherUser)).movies.map(
        (movie) => movie.id
      )
    ).toEqual([movieId]);
    expect(
      (await search({}, otherUser)).movies.map((movie) => movie.seen)
    ).toEqual([true]);
  });

  it("treats LIKE metacharacters literally and searches case-insensitively", async () => {
    const literal = `${prefix} 100%_\\Movie`;
    const id = await fixtures.movie({ title: literal });
    await fixtures.movie({ title: `${prefix} 100anything-Movie` });
    expect(
      (await search({ title: literal.toUpperCase() })).movies.map(
        (movie) => movie.id
      )
    ).toEqual([id]);
    expect(
      (await search({ title: `${prefix} '; DROP TABLE movies; --` })).movies
    ).toEqual([]);
  });

  it("applies genre/decade filters without duplicating rows or shifting dates", async () => {
    const genre = await fixtures.genre();
    const otherGenre = await fixtures.genre();
    const id = await fixtures.movie({
      title: prefix,
      releaseDate: "1999-12-31",
    });
    await fixtures.movie({ title: prefix, releaseDate: "2000-01-01" });
    await db.insert(movieGenres).values([
      { movieId: id, genreId: genre },
      { movieId: id, genreId: otherGenre },
    ]);
    const result = await search({ genre, decade: 1990 });
    expect(
      result.movies.map((movie) => ({ id: movie.id, year: movie.year }))
    ).toEqual([{ id, year: 1999 }]);
  });

  it("paginates with a stable tie-breaker and detects only a real next page", async () => {
    const ids: number[] = [];
    for (let index = 0; index < PAGE_SIZE + 1; index++)
      ids.push(await fixtures.movie({ title: prefix, voteCount: 10 }));
    ids.sort((a, b) => a - b);
    const first = await search();
    const second = await search({ page: 2 });
    expect(first.movies.map((movie) => movie.id)).toEqual(
      ids.slice(0, PAGE_SIZE)
    );
    expect(first.hasNextPage).toBe(true);
    expect(second.movies.map((movie) => movie.id)).toEqual(
      ids.slice(PAGE_SIZE)
    );
    expect(second.hasNextPage).toBe(false);
  });

  it("orders the catalog by votes and the personal list by newest confirmation", async () => {
    const popular = await fixtures.movie({ title: prefix, voteCount: 100 });
    const recent = await fixtures.movie({ title: prefix, voteCount: 1 });
    await markSeen(popular);
    await markSeen(recent);
    await db
      .update(seenMovies)
      .set({ createdAt: new Date("2020-01-01") })
      .where(eq(seenMovies.movieId, popular));
    await db
      .update(seenMovies)
      .set({ createdAt: new Date("2021-01-01") })
      .where(eq(seenMovies.movieId, recent));
    expect((await search()).movies.map((movie) => movie.id)).toEqual([
      popular,
      recent,
    ]);
    expect(
      (await search({ scope: "mine" })).movies.map((movie) => movie.id)
    ).toEqual([recent, popular]);
    // Both confirmations remain present; ordering doesn't mutate stored facts.
    expect(
      await db.$count(
        seenMovies,
        inArray(seenMovies.movieId, [popular, recent])
      )
    ).toBe(2);
  });
});
