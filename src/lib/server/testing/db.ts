import { randomInt } from "node:crypto";

import { inArray } from "drizzle-orm";

import { createDb, type Db } from "#lib/server/db/client.ts";
import { genres, movies, type NewMovie, users } from "#lib/server/db/schema.ts";

import { testDatabaseUrl } from "./environment.ts";

// Shared by tests that need a real database (Vitest and Playwright alike).

/**
 * TEST_DATABASE_URL must explicitly select a disposable database, locally and
 * in CI. Two connections let tests run transactions side by side.
 */
export function connectTestDb() {
  return createDb(testDatabaseUrl(), 2);
}

/**
 * An ID for a test movie: far above TMDB's IDs (under 2 million today), so it
 * never collides with a real movie.
 */
export function testMovieId(): number {
  return randomInt(1_000_000_000, 2_000_000_000);
}

/**
 * Creates users and movies for a test file and deletes them afterwards, so
 * test files can share a disposable database without seeing each other's rows.
 */
export function createFixtures(db: Db) {
  const userIds: string[] = [];
  const movieIds: number[] = [];
  const genreIds: number[] = [];

  return {
    async user(): Promise<string> {
      const id = crypto.randomUUID();
      // A reserved domain that can't receive mail.
      await db
        .insert(users)
        .values({ id, name: "", email: `${id}@example.test` });
      userIds.push(id);
      return id;
    },

    async movie(fields: Partial<NewMovie> = {}): Promise<number> {
      const id = fields.id ?? testMovieId();
      await db.insert(movies).values({
        title: `Test movie ${String(id)}`,
        voteCount: 0,
        syncedAt: new Date(),
        ...fields,
        id,
      });
      movieIds.push(id);
      return id;
    },

    async genre(): Promise<number> {
      const id = testMovieId();
      await db.insert(genres).values({ id, name: `Test genre ${String(id)}` });
      genreIds.push(id);
      return id;
    },

    // Users first: deleting them cascades to their seen movies and actions,
    // which would otherwise block deleting the movies.
    async cleanUp(): Promise<void> {
      if (userIds.length > 0) {
        await db.delete(users).where(inArray(users.id, userIds));
      }
      if (movieIds.length > 0) {
        await db.delete(movies).where(inArray(movies.id, movieIds));
      }
      if (genreIds.length > 0) {
        await db.delete(genres).where(inArray(genres.id, genreIds));
      }
    },
  };
}
