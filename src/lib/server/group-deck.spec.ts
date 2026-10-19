import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ANIMATION_GENRE_ID,
  NO_PREFERENCES,
  type Preferences,
} from "#lib/deck-fields.ts";
import {
  genres,
  groups,
  movieGenres,
  type NewMovie,
  notSeenMovies,
} from "#lib/server/db/schema.ts";
import {
  answerMovie,
  canUndo,
  dealCards,
  listMatches,
  listWaitingOn,
  listWatched,
  markWatched,
  NOT_SEEN_DAYS,
  pollGroupDeck,
  readDeckState,
  undoLastAnswer,
  unmarkWatched,
  VOTE_COUNT_FLOOR,
} from "#lib/server/group-deck.ts";
import {
  createGroup,
  joinGroup,
  leaveGroup,
  setNickname,
} from "#lib/server/groups.ts";
import { addToSeenList, removeFromSeenList } from "#lib/server/seen-list.ts";
import { connectTestDb, createFixtures } from "#lib/server/testing/db.ts";

// Runs against a real database: the deck, matches, and expiry are SQL, and
// row locks are what keep answers consistent.
const { pool, db } = connectTestDb();
const fixtures = createFixtures(db);
// Deleting users leaves their groups behind; track them.
const groupIds: string[] = [];

afterAll(async () => {
  if (groupIds.length > 0) {
    await db.delete(groups).where(inArray(groups.id, groupIds));
  }
  await fixtures.cleanUp();
  await pool.end();
});

const id = () => crypto.randomUUID();

/**
 * A group and a genre every test movie belongs to. Decks prefer that genre,
 * so other test files' movies (same database, running in parallel) never
 * reach them as new movies.
 */
interface World {
  groupId: string;
  genreId: number;
  /** The group's creator. */
  me: string;
}

async function newWorld(): Promise<World> {
  const me = await fixtures.user();
  const groupId = id();
  groupIds.push(groupId);
  const outcome = await createGroup(db, {
    actionId: id(),
    userId: me,
    groupId,
    name: "Movie night",
    nickname: "Me",
  });
  expect(outcome).toBe("applied");
  return { groupId, genreId: await fixtures.genre(), me };
}

async function join(groupId: string, nickname: string, userId?: string) {
  const member = userId ?? (await fixtures.user());
  const group = await db.query.groups.findFirst({
    columns: { inviteCode: true },
    where: { id: groupId },
  });
  const outcome = await joinGroup(db, {
    actionId: id(),
    userId: member,
    groupId,
    inviteCode: group?.inviteCode ?? "",
    nickname,
  });
  expect(outcome).toBe("applied");
  return member;
}

/** A dealable movie (enough votes, released) in the world's genre. */
async function movie(
  world: World,
  fields: Partial<NewMovie> & { genreIds?: number[] } = {}
): Promise<number> {
  const { genreIds = [world.genreId], ...movieFields } = fields;
  const movieId = await fixtures.movie({
    voteCount: VOTE_COUNT_FLOOR + 1000,
    voteAverage: 7,
    releaseDate: "2000-06-01",
    usReleaseDate: "2000-06-01",
    runtime: 100,
    ...movieFields,
  });
  if (genreIds.length > 0) {
    await db
      .insert(movieGenres)
      .values(genreIds.map((genreId) => ({ movieId, genreId })));
  }
  return movieId;
}

function prefs(world: World, more: Partial<Preferences> = {}): Preferences {
  return { ...NO_PREFERENCES, genreIds: [world.genreId], ...more };
}

async function deal(
  world: World,
  userId: string,
  preferences = prefs(world),
  exclude: number[] = []
) {
  const cards = await dealCards(db, {
    groupId: world.groupId,
    userId,
    preferences,
    exclude,
    limit: 50,
  });
  return cards.map((card) => card.id);
}

function answer(
  world: World,
  userId: string,
  movieId: number,
  choice: "seen" | "not_seen",
  actionId = id(),
  groupId = world.groupId
) {
  return answerMovie(db, {
    actionId,
    userId,
    groupId,
    movieId,
    answer: choice,
  });
}

function undo(world: World, userId: string, groupId = world.groupId) {
  return undoLastAnswer(db, { actionId: id(), userId, groupId });
}

async function matchIds(world: World, preferences: Preferences | null = null) {
  return (await listMatches(db, world.groupId, preferences)).map(
    (card) => card.id
  );
}

async function seenList(userId: string) {
  const rows = await db.query.seenMovies.findMany({
    columns: { movieId: true },
    where: { userId },
  });
  return rows.map((row) => row.movieId);
}

/** Moves a Not seen answer back in time, as if given `ageMinutes` ago. */
async function age(userId: string, movieId: number, ageMinutes: number) {
  await db
    .update(notSeenMovies)
    .set({
      answeredAt: sql`now() - make_interval(mins => ${ageMinutes}::int)`,
    })
    .where(
      and(eq(notSeenMovies.userId, userId), eq(notSeenMovies.movieId, movieId))
    );
}

function state(world: World, userId: string, preferences = prefs(world)) {
  return readDeckState(db, {
    groupId: world.groupId,
    userId,
    preferences,
    exclude: [],
  });
}

let world: World;

beforeEach(async () => {
  world = await newWorld();
});

describe("deck order", () => {
  it("deals the best weighted rating first, then by movie ID", async () => {
    // Weighted: (votes × rating + 500 × 6.5) / (votes + 500).
    const fewVotes = await movie(world, { voteAverage: 9, voteCount: 1000 }); // 8.17
    const many = await movie(world, { voteAverage: 8.4, voteCount: 30_000 }); // 8.37
    const ok = await movie(world, { voteAverage: 7, voteCount: 5000 }); // 6.95
    const tieLow = await movie(world, {
      id: 1_200_000_001,
      voteAverage: 6,
      voteCount: 1000,
    });
    const tieHigh = await movie(world, {
      id: 1_200_000_002,
      voteAverage: 6,
      voteCount: 1000,
    });

    expect(await deal(world, world.me)).toEqual([
      many,
      fewVotes,
      ok,
      tieLow,
      tieHigh,
    ]);
  });

  it("leaves out obscure, unreleased, watched, and excluded movies", async () => {
    const dealt = await movie(world);
    await movie(world, { voteCount: VOTE_COUNT_FLOOR - 1 });
    await movie(world, { usReleaseDate: null });
    await movie(world, { usReleaseDate: "2999-01-01" });
    const watched = await movie(world);
    const onScreen = await movie(world);
    await markWatched(db, {
      actionId: id(),
      userId: world.me,
      groupId: world.groupId,
      movieId: watched,
    });

    expect(await deal(world, world.me, prefs(world), [onScreen])).toEqual([
      dealt,
    ]);
  });

  it("leaves out movies anyone in the group has seen, and your own Not seen", async () => {
    const theirs = await movie(world);
    const mine = await movie(world);
    const fresh = await movie(world);
    const sam = await join(world.groupId, "Sam");
    await addToSeenList(db, { actionId: id(), userId: sam, movieId: theirs });
    await answer(world, world.me, mine, "not_seen");

    expect(await deal(world, world.me)).toEqual([fresh]);
  });

  it("deals movies others said Not seen to first, most confirmations first", async () => {
    const best = await movie(world, { voteAverage: 9, voteCount: 90_000 });
    const once = await movie(world, { voteAverage: 6 });
    const twice = await movie(world, { voteAverage: 5 });
    const sam = await join(world.groupId, "Sam");
    const alex = await join(world.groupId, "Alex");
    await answer(world, sam, once, "not_seen");
    await answer(world, sam, twice, "not_seen");
    await answer(world, alex, twice, "not_seen");

    expect(await deal(world, world.me)).toEqual([twice, once, best]);
  });

  it("deals started movies whatever your preferences", async () => {
    const otherGenre = await fixtures.genre();
    const comedy = await movie(world, { genreIds: [otherGenre] });
    const horror = await movie(world);
    const sam = await join(world.groupId, "Sam");
    await answer(world, sam, comedy, "not_seen");

    // Your preferences pick only new movies: Sam's started one comes too.
    expect(await deal(world, world.me)).toEqual([comedy, horror]);
  });

  it("applies runtime and year preferences to new movies", async () => {
    const short = await movie(world, { runtime: 85 });
    await movie(world, { runtime: 140 });
    await movie(world, { runtime: null });
    const nineties = await movie(world, {
      runtime: 85,
      releaseDate: "1995-01-01",
    });

    expect(
      await deal(world, world.me, prefs(world, { maxRuntime: 90 }))
    ).toHaveLength(2);
    expect(
      await deal(
        world,
        world.me,
        prefs(world, { maxRuntime: 90, minYear: 1990, maxYear: 1999 })
      )
    ).toEqual([nineties]);
    expect(
      await deal(world, world.me, prefs(world, { minYear: 2000 }))
    ).toContain(short);
  });

  it("applies animation and age rating preferences to new movies", async () => {
    // TMDB's real Animation genre; the catalog may already have it.
    await db
      .insert(genres)
      .values({ id: ANIMATION_GENRE_ID, name: "Animation" })
      .onConflictDoNothing();
    const cartoon = await movie(world, {
      genreIds: [world.genreId, ANIMATION_GENRE_ID],
      usCertification: "PG",
    });
    const rated = await movie(world, { usCertification: "R" });
    const adultsOnly = await movie(world, { usCertification: "NC-17" });
    const notRated = await movie(world, { usCertification: "NR" });
    const unknown = await movie(world, { usCertification: null });
    const dealt = async (more: Partial<Preferences>) =>
      (await deal(world, world.me, prefs(world, more))).toSorted(
        (a, b) => a - b
      );
    const sorted = (ids: number[]) => ids.toSorted((a, b) => a - b);

    expect(await dealt({ animation: "only" })).toEqual([cartoon]);
    expect(await dealt({ animation: "exclude" })).toEqual(
      sorted([rated, adultsOnly, notRated, unknown])
    );
    // R includes NC-17; Not rated includes a missing rating.
    expect(await dealt({ ratings: ["R"] })).toEqual(
      sorted([rated, adultsOnly])
    );
    expect(await dealt({ ratings: ["PG", "NR"] })).toEqual(
      sorted([cartoon, notRated, unknown])
    );
  });
});

describe("matches", () => {
  it("is a match when every member said Not seen and nobody has seen it", async () => {
    const both = await movie(world);
    const oneSeen = await movie(world);
    const sam = await join(world.groupId, "Sam");
    await answer(world, world.me, both, "not_seen");
    await answer(world, world.me, oneSeen, "not_seen");
    expect(await matchIds(world)).toEqual([]);

    await answer(world, sam, both, "not_seen");
    await answer(world, sam, oneSeen, "seen");
    expect(await matchIds(world)).toEqual([both]);
  });

  it("makes every Not seen a match in a group of one", async () => {
    const solo = await movie(world);
    await answer(world, world.me, solo, "not_seen");
    expect(await matchIds(world)).toEqual([solo]);
  });

  it("waits for someone who joins, and drops someone who leaves", async () => {
    const film = await movie(world);
    await answer(world, world.me, film, "not_seen");
    const sam = await join(world.groupId, "Sam");
    expect(await matchIds(world)).toEqual([]);
    // The newcomer gets it first, as a started movie.
    expect((await deal(world, sam))[0]).toBe(film);

    await leaveGroup(db, {
      actionId: id(),
      userId: sam,
      groupId: world.groupId,
    });
    expect(await matchIds(world)).toEqual([film]);
  });

  it("counts answers from any group: an answer is about the person", async () => {
    const film = await movie(world);
    const other = await newWorld();
    const sam = await join(world.groupId, "Sam");
    await join(other.groupId, "Sam", sam);
    await answer(world, world.me, film, "not_seen");
    // Sam answers in the other group's deck.
    await answer(other, sam, film, "not_seen");

    expect(await matchIds(world)).toEqual([film]);
  });

  it("forms a match between people with different preferences", async () => {
    const comedyGenre = world.genreId;
    const horrorGenre = await fixtures.genre();
    const comedy = await movie(world);
    const horror = await movie(world, { genreIds: [horrorGenre] });
    const sam = await join(world.groupId, "Sam");
    const myPrefs = prefs(world, { genreIds: [comedyGenre] });
    const samsPrefs = prefs(world, { genreIds: [horrorGenre] });

    expect(await deal(world, world.me, myPrefs)).toEqual([comedy]);
    await answer(world, world.me, comedy, "not_seen");
    // Sam prefers horror, but the comedy I started comes first.
    expect(await deal(world, sam, samsPrefs)).toEqual([comedy, horror]);
    await answer(world, sam, comedy, "not_seen");

    expect(await matchIds(world)).toEqual([comedy]);
  });

  it("lists matches that fit your preferences first", async () => {
    const otherGenre = await fixtures.genre();
    const fits = await movie(world, { voteAverage: 5 });
    const better = await movie(world, {
      voteAverage: 9,
      genreIds: [otherGenre],
    });
    await answer(world, world.me, fits, "not_seen");
    await answer(world, world.me, better, "not_seen");

    expect(await matchIds(world)).toEqual([better, fits]);
    expect(await matchIds(world, prefs(world))).toEqual([fits, better]);
  });
});

describe("2-week memory", () => {
  const limit = NOT_SEEN_DAYS * 24 * 60;

  it("counts a Not seen until it's 2 weeks old", async () => {
    const film = await movie(world);
    await answer(world, world.me, film, "not_seen");

    await age(world.me, film, limit - 1);
    expect(await matchIds(world)).toEqual([film]);
    expect(await deal(world, world.me)).toEqual([]);

    await age(world.me, film, limit + 1);
    expect(await matchIds(world)).toEqual([]);
    // Dealt again, so you can confirm it.
    expect(await deal(world, world.me)).toEqual([film]);
  });

  it("restarts the 2 weeks when you answer Not seen again", async () => {
    const film = await movie(world);
    await answer(world, world.me, film, "not_seen");
    await age(world.me, film, limit + 1);
    await answer(world, world.me, film, "not_seen");

    expect(await matchIds(world)).toEqual([film]);
  });

  it("stops counting an expired answer as started for others", async () => {
    const film = await movie(world, { voteAverage: 4 });
    const better = await movie(world, { voteAverage: 9 });
    const sam = await join(world.groupId, "Sam");
    await answer(world, sam, film, "not_seen");
    await age(sam, film, limit + 1);

    expect(await deal(world, world.me)).toEqual([better, film]);
  });
});

describe("Waiting on", () => {
  it("lists movies two or more said Not seen to, with who hasn't answered", async () => {
    const film = await movie(world);
    const single = await movie(world);
    const sam = await join(world.groupId, "Sam");
    const alex = await join(world.groupId, "Alex");
    await answer(world, world.me, film, "not_seen");
    await answer(world, sam, film, "not_seen");
    await answer(world, world.me, single, "not_seen");

    const waiting = await listWaitingOn(db, world.groupId, world.me);
    expect(
      waiting.map((row) => [row.movie.id, row.waitingOnYou, row.waitingOn])
    ).toEqual([[film, false, ["Alex"]]]);
    // Sam sees the same movie waiting on Alex, not on themselves.
    const fromSam = await listWaitingOn(db, world.groupId, sam);
    expect(fromSam.map((row) => row.waitingOn)).toEqual([["Alex"]]);
    // Alex is told it's waiting on them.
    const fromAlex = await listWaitingOn(db, world.groupId, alex);
    expect(fromAlex.map((row) => [row.waitingOnYou, row.waitingOn])).toEqual([
      [true, []],
    ]);
  });

  it("leaves out movies someone in the group has seen", async () => {
    const film = await movie(world);
    const sam = await join(world.groupId, "Sam");
    const alex = await join(world.groupId, "Alex");
    await answer(world, world.me, film, "not_seen");
    await answer(world, sam, film, "not_seen");
    await addToSeenList(db, { actionId: id(), userId: alex, movieId: film });

    expect(await listWaitingOn(db, world.groupId, world.me)).toEqual([]);
  });

  it("names who you're waiting on when you run out of cards", async () => {
    const film = await movie(world);
    const sam = await join(world.groupId, "Sam");
    const alex = await join(world.groupId, "Alex");
    await answer(world, world.me, film, "not_seen");
    await answer(world, sam, film, "not_seen");

    const mine = await state(world, world.me);
    expect(mine.cards).toEqual([]);
    expect(mine.waitingOn).toEqual(["Alex"]);
    // Alex still has the card, so isn't waiting on anyone.
    const alexs = await state(world, alex);
    expect(alexs.cards.map((card) => card.id)).toEqual([film]);
    expect(alexs.waitingOn).toBeNull();
  });
});

describe("We watched this", () => {
  it("takes a match out of the matches and the deck, and back on unmark", async () => {
    const film = await movie(world);
    await answer(world, world.me, film, "not_seen");
    const change = {
      actionId: id(),
      userId: world.me,
      groupId: world.groupId,
      movieId: film,
    };
    expect(await markWatched(db, change)).toBe("applied");
    expect(await markWatched(db, change)).toBe("duplicate");
    expect(await matchIds(world)).toEqual([]);
    expect(
      (await listWatched(db, world.groupId)).map((card) => card.id)
    ).toEqual([film]);
    // Nobody's seen list changes.
    expect(await seenList(world.me)).toEqual([]);

    expect(await unmarkWatched(db, { ...change, actionId: id() })).toBe(
      "applied"
    );
    expect(await matchIds(world)).toEqual([film]);
  });

  it("refuses non-members like a missing group", async () => {
    const film = await movie(world);
    const stranger = await fixtures.user();
    expect(
      await markWatched(db, {
        actionId: id(),
        userId: stranger,
        groupId: world.groupId,
        movieId: film,
      })
    ).toBe("not_found");
  });
});

describe("answering", () => {
  it("puts Seen on your seen list and replaces your Not seen", async () => {
    const film = await movie(world);
    await answer(world, world.me, film, "not_seen");
    expect(await matchIds(world)).toEqual([film]);

    // "Actually, I've seen this."
    expect(await answer(world, world.me, film, "seen")).toBe("applied");
    expect(await seenList(world.me)).toEqual([film]);
    expect(await matchIds(world)).toEqual([]);
  });

  it("recognizes retries and refuses reused action IDs", async () => {
    const film = await movie(world);
    const other = await movie(world);
    const actionId = id();
    expect(await answer(world, world.me, film, "not_seen", actionId)).toBe(
      "applied"
    );
    expect(await answer(world, world.me, film, "not_seen", actionId)).toBe(
      "duplicate"
    );
    expect(await answer(world, world.me, other, "not_seen", actionId)).toBe(
      "conflict"
    );
    expect(await answer(world, world.me, film, "seen", actionId)).toBe(
      "conflict"
    );
  });

  it("refuses non-members and unknown movies", async () => {
    const film = await movie(world);
    const stranger = await fixtures.user();
    expect(await answer(world, stranger, film, "not_seen")).toBe("not_found");
    expect(await answer(world, world.me, 1_999_999_999, "not_seen")).toBe(
      "movie_not_found"
    );
  });

  it("applies simultaneous answers from everyone", async () => {
    const film = await movie(world);
    const sam = await join(world.groupId, "Sam");
    const actionId = id();
    const outcomes = await Promise.all([
      answer(world, world.me, film, "not_seen", actionId),
      answer(world, world.me, film, "not_seen", actionId),
      answer(world, sam, film, "not_seen"),
    ]);

    expect(outcomes.sort()).toEqual(["applied", "applied", "duplicate"]);
    expect(await matchIds(world)).toEqual([film]);
  });
});

describe("undo", () => {
  it("steps back through your answers in this group, newest first", async () => {
    const first = await movie(world);
    const second = await movie(world);
    await answer(world, world.me, first, "not_seen");
    await answer(world, world.me, second, "seen");

    expect(await undo(world, world.me)).toEqual({
      outcome: "applied",
      movieId: second,
    });
    expect(await seenList(world.me)).toEqual([]);
    expect(await undo(world, world.me)).toEqual({
      outcome: "applied",
      movieId: first,
    });
    expect(await matchIds(world)).toEqual([]);
    expect(await undo(world, world.me)).toEqual({
      outcome: "nothing_to_undo",
      movieId: null,
    });
    expect(await canUndo(db, world.me, world.groupId)).toBe(false);
  });

  it("keeps each group's stack separate, but an undo counts everywhere", async () => {
    const film = await movie(world);
    const elsewhere = await movie(world);
    const other = await newWorld();
    await join(other.groupId, "Me too", world.me);
    await answer(world, world.me, film, "not_seen");
    await answer(other, world.me, elsewhere, "not_seen");
    await answer(other, other.me, film, "not_seen");
    await answer(other, other.me, elsewhere, "not_seen");
    expect(
      (await listMatches(db, other.groupId)).map((card) => card.id).sort()
    ).toEqual([film, elsewhere].sort());

    // Undo in this group skips the other group's newer answer.
    expect((await undo(world, world.me)).movieId).toBe(film);
    expect(await canUndo(db, world.me, world.groupId)).toBe(false);
    expect(await canUndo(db, world.me, other.groupId)).toBe(true);
    // And the undone Not seen is gone from the other group too.
    expect(
      (await listMatches(db, other.groupId)).map((card) => card.id)
    ).toEqual([elsewhere]);
  });

  it("brings back the Not seen a Seen replaced, with its original time", async () => {
    const film = await movie(world);
    const notSeen = id();
    await answer(world, world.me, film, "not_seen", notSeen);
    await answer(world, world.me, film, "seen");
    await undo(world, world.me);

    expect(await seenList(world.me)).toEqual([]);
    expect(await matchIds(world)).toEqual([film]);
    const [row] = await db
      .select({
        answeredAt: notSeenMovies.answeredAt,
        lastConfirmedByAction: notSeenMovies.lastConfirmedByAction,
      })
      .from(notSeenMovies)
      .where(
        and(eq(notSeenMovies.userId, world.me), eq(notSeenMovies.movieId, film))
      );
    const original = await db.query.actions.findFirst({
      columns: { createdAt: true },
      where: { id: notSeen },
    });
    // The original answer and its time, so it expires when it would have.
    expect(row?.lastConfirmedByAction).toBe(notSeen);
    expect(row?.answeredAt).toEqual(original?.createdAt);
  });

  it("keeps a seen entry confirmed again elsewhere", async () => {
    const film = await movie(world);
    await answer(world, world.me, film, "seen");
    await addToSeenList(db, {
      actionId: id(),
      userId: world.me,
      movieId: film,
    });
    await undo(world, world.me);

    expect(await seenList(world.me)).toEqual([film]);
  });

  it("lets earlier Not seen answers count again once a seen entry is removed", async () => {
    const film = await movie(world);
    await answer(world, world.me, film, "not_seen");
    await addToSeenList(db, {
      actionId: id(),
      userId: world.me,
      movieId: film,
    });
    expect(await matchIds(world)).toEqual([]);

    await removeFromSeenList(db, {
      actionId: id(),
      userId: world.me,
      movieId: film,
    });
    expect(await matchIds(world)).toEqual([film]);
  });
});

describe("polling", () => {
  async function poll(userId: string, since: string) {
    return pollGroupDeck(db, {
      groupId: world.groupId,
      userId,
      preferences: prefs(world),
      exclude: [],
      since,
    });
  }

  it("answers unchanged until someone in the group changes something", async () => {
    const film = await movie(world);
    const sam = await join(world.groupId, "Sam");
    const { fingerprint } = await state(world, world.me);
    expect(await poll(world.me, fingerprint)).toEqual({ status: "unchanged" });

    await answer(world, sam, film, "not_seen");
    const reply = await poll(world.me, fingerprint);
    expect(reply.status).toBe("changed");
    if (reply.status !== "changed") return;
    expect(reply.state.cards.map((card) => card.id)).toEqual([film]);
    expect(reply.state.fingerprint).not.toBe(fingerprint);
    expect(await poll(world.me, reply.state.fingerprint)).toEqual({
      status: "unchanged",
    });
  });

  it("notices membership, nickname, and watched changes", async () => {
    const film = await movie(world);
    let { fingerprint } = await state(world, world.me);
    const changed = async () => {
      const reply = await poll(world.me, fingerprint);
      if (reply.status === "changed") fingerprint = reply.state.fingerprint;
      return reply.status;
    };

    const sam = await join(world.groupId, "Sam");
    expect(await changed()).toBe("changed");
    await setNickname(db, {
      actionId: id(),
      userId: sam,
      groupId: world.groupId,
      nickname: "Samantha",
    });
    expect(await changed()).toBe("changed");
    await markWatched(db, {
      actionId: id(),
      userId: sam,
      groupId: world.groupId,
      movieId: film,
    });
    expect(await changed()).toBe("changed");
    await leaveGroup(db, {
      actionId: id(),
      userId: sam,
      groupId: world.groupId,
    });
    expect(await changed()).toBe("changed");
    expect(await changed()).toBe("unchanged");
  });

  it("notices a Not seen expiring, which writes nothing", async () => {
    const film = await movie(world);
    const sam = await join(world.groupId, "Sam");
    await answer(world, world.me, film, "not_seen");
    await answer(world, sam, film, "not_seen");
    const limit = NOT_SEEN_DAYS * 24 * 60;
    await age(sam, film, limit - 1);
    const before = await state(world, world.me);
    expect(before.matchCount).toBe(1);

    // Moves Sam's answer past its expiry without bumping any counter, as
    // the passing of time does.
    await age(sam, film, limit + 1);
    const reply = await poll(world.me, before.fingerprint);
    expect(reply.status).toBe("changed");
    if (reply.status !== "changed") return;
    expect(reply.state.matchCount).toBe(0);
  });

  it("ends for someone no longer in the group", async () => {
    const sam = await join(world.groupId, "Sam");
    const { fingerprint } = await state(world, sam);
    await leaveGroup(db, {
      actionId: id(),
      userId: sam,
      groupId: world.groupId,
    });

    expect(await poll(sam, fingerprint)).toEqual({ status: "ended" });
  });
});
