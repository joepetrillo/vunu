import { count, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { actions } from "#lib/server/db/schema.ts";
import {
  addToSeenList,
  removeFromSeenList,
  type SeenListChange,
} from "#lib/server/seen-list.ts";
import {
  connectTestDb,
  createFixtures,
  testMovieId,
} from "#lib/server/testing/db.ts";

// Runs against a real database: transactions, row locks, and constraints are
// what's being tested here.
const { pool, db } = connectTestDb();
const fixtures = createFixtures(db);

afterAll(async () => {
  await fixtures.cleanUp();
  await pool.end();
});

async function seenVersion(userId: string): Promise<number | undefined> {
  const user = await db.query.users.findFirst({
    columns: { seenVersion: true },
    where: { id: userId },
  });
  return user?.seenVersion;
}

async function seenMovieIds(userId: string): Promise<number[]> {
  const rows = await db.query.seenMovies.findMany({
    columns: { movieId: true },
    where: { userId },
  });
  return rows.map((row) => row.movieId).sort();
}

async function loggedActions(actionId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(actions)
    .where(eq(actions.id, actionId));
  return row?.n ?? 0;
}

describe("seen list", () => {
  let change: SeenListChange;

  beforeEach(async () => {
    change = {
      actionId: crypto.randomUUID(),
      userId: await fixtures.user(),
      movieId: await fixtures.movie(),
    };
  });

  it("adds a movie and bumps seen_version", async () => {
    expect(await addToSeenList(db, change)).toBe("applied");

    expect(await seenMovieIds(change.userId)).toEqual([change.movieId]);
    expect(await seenVersion(change.userId)).toBe(1);
    expect(await loggedActions(change.actionId)).toBe(1);
  });

  it("treats a retried action as a duplicate that changes nothing", async () => {
    await addToSeenList(db, change);

    expect(await addToSeenList(db, change)).toBe("duplicate");

    expect(await seenMovieIds(change.userId)).toEqual([change.movieId]);
    expect(await seenVersion(change.userId)).toBe(1);
    expect(await loggedActions(change.actionId)).toBe(1);
  });

  it("rejects an action ID reused with different input, changing nothing", async () => {
    const otherMovieId = await fixtures.movie();
    const otherUserId = await fixtures.user();
    await addToSeenList(db, change);

    // Same ID, but a different movie, kind of change, or user.
    expect(await addToSeenList(db, { ...change, movieId: otherMovieId })).toBe(
      "conflict"
    );
    expect(await removeFromSeenList(db, change)).toBe("conflict");
    expect(await addToSeenList(db, { ...change, userId: otherUserId })).toBe(
      "conflict"
    );

    expect(await seenMovieIds(change.userId)).toEqual([change.movieId]);
    expect(await seenMovieIds(otherUserId)).toEqual([]);
    expect(await seenVersion(change.userId)).toBe(1);
    expect(await seenVersion(otherUserId)).toBe(0);
  });

  it("applies a double submit once", async () => {
    // Two requests with the same ID at the same moment, on separate
    // connections: the second waits for the first, then sees its log entry.
    const outcomes = await Promise.all([
      addToSeenList(db, change),
      addToSeenList(db, change),
    ]);

    expect(outcomes.sort()).toEqual(["applied", "duplicate"]);
    expect(await seenVersion(change.userId)).toBe(1);
  });

  it("doesn't double-count concurrent distinct actions adding the same movie", async () => {
    const outcomes = await Promise.all([
      addToSeenList(db, change),
      addToSeenList(db, { ...change, actionId: crypto.randomUUID() }),
    ]);
    expect(outcomes).toEqual(["applied", "applied"]);
    expect(await seenMovieIds(change.userId)).toEqual([change.movieId]);
    expect(await seenVersion(change.userId)).toBe(1);
  });

  it("doesn't lose version increments when different movies are saved concurrently", async () => {
    const movieId = await fixtures.movie();
    await Promise.all([
      addToSeenList(db, change),
      addToSeenList(db, { ...change, actionId: crypto.randomUUID(), movieId }),
    ]);
    expect(await seenMovieIds(change.userId)).toEqual(
      [change.movieId, movieId].sort()
    );
    expect(await seenVersion(change.userId)).toBe(2);
  });

  it("removes a movie and bumps seen_version; a retry changes nothing", async () => {
    await addToSeenList(db, change);
    const removal = { ...change, actionId: crypto.randomUUID() };

    expect(await removeFromSeenList(db, removal)).toBe("applied");
    expect(await removeFromSeenList(db, removal)).toBe("duplicate");

    expect(await seenMovieIds(change.userId)).toEqual([]);
    expect(await seenVersion(change.userId)).toBe(2);
  });

  it("doesn't bump seen_version when the list doesn't change", async () => {
    await addToSeenList(db, change);

    // New actions, but the movie is already seen, then one that isn't seen.
    const again = { ...change, actionId: crypto.randomUUID() };
    expect(await addToSeenList(db, again)).toBe("applied");
    const unseenMovie = {
      ...change,
      actionId: crypto.randomUUID(),
      movieId: await fixtures.movie(),
    };
    expect(await removeFromSeenList(db, unseenMovie)).toBe("applied");

    expect(await seenVersion(change.userId)).toBe(1);
  });

  it("logs nothing when a change fails, so its retry runs normally", async () => {
    // Not in the catalog yet, so the foreign key makes the change fail.
    const notInCatalog = { ...change, movieId: testMovieId() };
    await expect(addToSeenList(db, notInCatalog)).rejects.toThrow();
    expect(await loggedActions(change.actionId)).toBe(0);

    await fixtures.movie({ id: notInCatalog.movieId });
    expect(await addToSeenList(db, notInCatalog)).toBe("applied");
  });
});
