import { randomInt } from "node:crypto";

import { type Browser, expect, type Page, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";

import {
  actions,
  genres,
  groupMembers,
  groups,
  movieGenres,
  seenMovies,
  users,
} from "#lib/server/db/schema.ts";
import { answerMovie, VOTE_COUNT_FLOOR } from "#lib/server/group-deck.ts";
import { connectTestDb, createFixtures } from "#lib/server/testing/db.ts";
import { deleteAccount, signIn } from "#lib/server/testing/sign-in.ts";
import { visit } from "#lib/server/testing/visit.ts";

// The group deck (stage 8): no sessions, everyone in the group counts, and
// tonight's preferences pick only new movies. Each person prefers a test
// genre, so other tests' movies (same database) never reach these decks.
// Changes reach other screens by polling, so cross-screen checks allow a
// few poll rounds.

const { pool, db } = connectTestDb();
const fixtures = createFixtures(db);

const runId = `e2e-${crypto.randomUUID()}`;
const emails: string[] = [];
const groupIds: string[] = [];
const LIVE = { timeout: 15_000 };

interface TestGenre {
  id: number;
  name: string;
  /** Best rated first, as the deck deals them. */
  movies: { id: number; title: string }[];
}
const comedy: TestGenre = { id: 0, name: "", movies: [] };
const horror: TestGenre = { id: 0, name: "", movies: [] };

test.beforeAll(async () => {
  for (const [label, genre] of [
    ["Comedy", comedy],
    ["Horror", horror],
  ] as const) {
    genre.id = await fixtures.genre();
    const row = await db.query.genres.findFirst({ where: { id: genre.id } });
    genre.name = row?.name ?? "";
    for (const [i, rating] of [8.5, 7.5, 6.5].entries()) {
      const title = `${label} ${String(i + 1)} ${runId}`;
      const id = await fixtures.movie({
        title,
        voteCount: VOTE_COUNT_FLOOR + 5000,
        voteAverage: rating,
        releaseDate: "2001-05-01",
        usReleaseDate: "2001-05-01",
        runtime: 110,
      });
      await db.insert(movieGenres).values({ movieId: id, genreId: genre.id });
      genre.movies.push({ id, title });
    }
  }
});

test.afterAll(async () => {
  if (groupIds.length > 0) {
    await db.delete(groups).where(inArray(groups.id, groupIds));
  }
  for (const email of emails) await deleteAccount(db, email);
  await fixtures.cleanUp();
  await db.delete(genres).where(inArray(genres.id, [comedy.id, horror.id]));
  await pool.end();
});

function title(genre: TestGenre, i: number): string {
  return genre.movies[i]?.title ?? "";
}

/** A signed-in browser of its own (own cookies, own client IP). */
async function person(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`,
    },
  });
  const page = await context.newPage();
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  return page;
}

async function userId(email: string | undefined): Promise<string> {
  const user = await db.query.users.findFirst({
    where: { email: email ?? "" },
  });
  return user?.id ?? "";
}

/** Creates a group on the page; returns its ID. */
async function createGroup(page: Page, nickname: string): Promise<string> {
  await page.getByRole("link", { name: "New group" }).click();
  await page.getByLabel("Group name").fill("Movie night");
  await page.getByLabel("What should this group call you?").fill(nickname);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Movie night"
  );
  const groupId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  groupIds.push(groupId);
  return groupId;
}

/** Joining is stage 5's journey; here someone is simply added. */
async function addMember(groupId: string, memberId: string, nickname: string) {
  await db
    .insert(groupMembers)
    .values({ groupId, userId: memberId, role: "member", nickname });
}

/**
 * From the group page: Find a movie, which asks what you're in the mood for
 * first, then one genre.
 */
async function findMovie(page: Page, genre: TestGenre): Promise<void> {
  await page.getByRole("link", { name: "Find a movie" }).click();
  await expect(
    page.getByRole("heading", { name: "In the mood for" })
  ).toBeVisible();
  await page.getByText(genre.name, { exact: true }).click();
  await page.getByRole("button", { name: "Show movies" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/find\\?.*genreIds=${String(genre.id)}`)
  );
  await expect(moodBar(page)).toContainText("1 filter");
}

/** The deck's "In the mood for" bar, which opens the preferences. */
function moodBar(page: Page) {
  return page.getByRole("button", { name: /^In the mood for/ });
}

function card(page: Page) {
  return page.getByRole("heading", { level: 1 });
}

function answer(page: Page, choice: "Seen" | "Not seen") {
  return page.getByRole("button", { name: choice, exact: true }).click();
}

function matchRows(page: Page) {
  return page
    .getByRole("region", { name: /^[\d,]+ match(es)?$/ })
    .getByRole("listitem");
}

/** Picks one of a match's menu items ("We watched this"). */
async function matchMenu(page: Page, movieTitle: string, item: string) {
  await page.getByRole("button", { name: `More for ${movieTitle}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("two people with different preferences reach a match from the group page", async ({
  browser,
}) => {
  const alex = await person(browser);
  const groupId = await createGroup(alex, "Alex");
  const sam = await person(browser);
  await addMember(groupId, await userId(emails.at(-1)), "Sam");
  // Jo is in the group but hasn't opened Vunu yet.
  const jo = await fixtures.user();
  await addMember(groupId, jo, "Jo");

  // Alex is in the mood for comedy, Sam for horror. No setup beyond that.
  await findMovie(alex, comedy);
  await expect(card(alex)).toHaveText(title(comedy, 0));
  await visit(sam, `/groups/${groupId}`);
  await findMovie(sam, horror);
  await expect(card(sam)).toHaveText(title(horror, 0));

  // Alex starts Comedy 1. Sam's card on screen never moves under a tap, but
  // the started comedy comes next, ahead of Sam's horror.
  const samSawIt = sam.waitForResponse(
    async (response) =>
      response.url().includes("/poll?") &&
      ((await response.json()) as { status: string }).status === "changed",
    LIVE
  );
  await answer(alex, "Not seen");
  await samSawIt;
  await expect(card(sam)).toHaveText(title(horror, 0));
  await answer(sam, "Seen");
  await expect(card(sam)).toHaveText(title(comedy, 0), LIVE);
  await answer(sam, "Not seen");

  // Everyone counts: it waits on Jo, by name, on the group page.
  await expect(sam.getByRole("link", { name: "Matches 0" })).toBeVisible();
  await sam.getByRole("link", { name: "Matches 0" }).click();
  await expect(sam.getByText(`Waiting on Jo`)).toBeVisible();

  // Jo answers (on their own phone); the match reaches Alex's deck live.
  expect(
    await answerMovie(db, {
      actionId: crypto.randomUUID(),
      userId: jo,
      groupId,
      movieId: comedy.movies[0]?.id ?? 0,
      answer: "not_seen",
    })
  ).toBe("applied");
  await expect(alex.getByRole("link", { name: "Matches 1" })).toBeVisible(LIVE);

  // On the matches screen: where to watch, then We watched this.
  await alex.getByRole("link", { name: "Matches 1" }).click();
  await expect(matchRows(alex)).toHaveCount(1);
  await expect(
    matchRows(alex).first().getByRole("link", { name: "Where to watch" })
  ).toHaveAttribute(
    "href",
    `https://www.themoviedb.org/movie/${String(comedy.movies[0]?.id)}/watch?locale=US`
  );
  await matchMenu(alex, title(comedy, 0), "We watched this");
  await expect(matchRows(alex)).toHaveCount(0);
  // It's on the group's Watched screen, where Remove takes it back.
  await alex.getByRole("link", { name: "Movie night" }).click();
  await alex.getByRole("link", { name: /^Watched/ }).click();
  await alex
    .getByRole("button", { name: `Remove ${title(comedy, 0)}` })
    .click();
  await expect(
    alex.getByRole("button", { name: `Remove ${title(comedy, 0)}` })
  ).toBeHidden();
  // A match again, which the home page counts on the group's row.
  await alex.goto("/");
  await expect(alex.getByRole("link", { name: /^Movie night/ })).toContainText(
    "3 people · 1 match"
  );
});

test("answers alone with undo and a correction", async ({ page }) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await createGroup(page, "Me");
  await findMovie(page, comedy);

  // Best rated first. Seen moves on; so does Not seen; Undo brings it back.
  await expect(card(page)).toHaveText(title(comedy, 0));
  await answer(page, "Seen");
  await expect(card(page)).toHaveText(title(comedy, 1));
  await answer(page, "Not seen");
  await expect(card(page)).toHaveText(title(comedy, 2));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page)).toHaveText(title(comedy, 1));
  await answer(page, "Not seen");
  await answer(page, "Not seen");
  await expect(
    page.getByText("That's every movie that fits your preferences.")
  ).toBeVisible();
  // In a group of one, every Not seen is a match.
  await expect(page.getByRole("link", { name: "Matches 2" })).toBeVisible();

  await page.getByRole("link", { name: "Matches 2" }).click();
  await expect(matchRows(page)).toHaveCount(2);
  await matchMenu(page, title(comedy, 1), "Actually, I've seen this");
  await expect(matchRows(page)).toHaveCount(1);
  await expect(matchRows(page).first()).toContainText(title(comedy, 2));

  // Seen answers went to the seen list.
  const seen = await db
    .select({ movieId: seenMovies.movieId })
    .from(seenMovies)
    .where(eq(seenMovies.userId, await userId(email)));
  expect(seen.map((row) => row.movieId).sort()).toEqual(
    [comedy.movies[0]?.id, comedy.movies[1]?.id].sort()
  );
});

/** Drags the card on screen sideways by `dx` px with the mouse. */
async function drag(page: Page, dx: number, { pause = 0 } = {}) {
  // The card on screen; wait out an earlier card still flying off.
  const top = page.locator("[data-deck] [aria-hidden='false']");
  await expect(top).toHaveCount(1);
  const box = await top.boundingBox();
  if (box === null) throw new Error("No card on screen.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  // Holding still before letting go: the release has no speed left.
  if (pause > 0) await page.waitForTimeout(pause);
  await page.mouse.up();
}

test("swipes answer like the buttons, and a short drag springs back", async ({
  page,
}) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await createGroup(page, "Me");
  await findMovie(page, comedy);

  // A short, slow drag doesn't answer.
  await expect(card(page)).toHaveText(title(comedy, 0));
  await drag(page, 40, { pause: 200 });
  await expect(card(page)).toHaveText(title(comedy, 0));

  // Left is Seen, right is Not seen, the same sides as the buttons.
  await drag(page, -250);
  await expect(card(page)).toHaveText(title(comedy, 1));
  await drag(page, 250);
  await expect(card(page)).toHaveText(title(comedy, 2));
  await expect(page.getByRole("link", { name: "Matches 1" })).toBeVisible();

  const seen = await db
    .select({ movieId: seenMovies.movieId })
    .from(seenMovies)
    .where(eq(seenMovies.userId, await userId(email)));
  expect(seen.map((row) => row.movieId)).toEqual([comedy.movies[0]?.id]);
});

test("a save that loses its response is retried once, not twice", async ({
  page,
}) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await createGroup(page, "Me");
  await findMovie(page, horror);
  await expect(card(page)).toHaveText(title(horror, 0));

  // The answer reaches the server, but the reply never reaches the browser.
  await page.route(
    (url) => url.searchParams.has("/answer"),
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 }
  );
  await answer(page, "Not seen");
  // The next card shows at once; the failed save waits for a retry.
  await expect(card(page)).toHaveText(title(horror, 1));
  await expect(page.getByText("Couldn't save your answer")).toBeVisible();

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Couldn't save your answer")).toBeHidden();
  await expect(page.getByRole("link", { name: "Matches 1" })).toBeVisible();

  const logged = await db
    .select({ type: actions.type })
    .from(actions)
    .innerJoin(users, eq(users.id, actions.userId))
    .where(and(eq(users.email, email), eq(actions.type, "answer_not_seen")));
  expect(logged).toHaveLength(1);
});

test("changes preferences from the deck's mood bar", async ({ page }) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await createGroup(page, "Me");
  await findMovie(page, comedy);
  await expect(card(page)).toHaveText(title(comedy, 0));

  // The sheet starts with tonight's picks; swap comedy for horror.
  await moodBar(page).click();
  const sheet = page.getByRole("dialog", { name: "In the mood for" });
  await sheet.getByText(comedy.name, { exact: true }).click();
  await sheet.getByText(horror.name, { exact: true }).click();
  await sheet.getByText("Not animated", { exact: true }).click();
  await sheet.getByRole("button", { name: "Show movies" }).click();

  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/animation=exclude/);
  await expect(moodBar(page)).toContainText("2 filters");
  await expect(card(page)).toHaveText(title(horror, 0));

  // The sheet is where the picks show in full.
  await moodBar(page).click();
  await expect(
    sheet.getByRole("checkbox", { name: horror.name })
  ).toBeChecked();
  await expect(
    sheet.getByRole("checkbox", { name: comedy.name })
  ).not.toBeChecked();
  await expect(
    sheet.getByRole("radio", { name: "Not animated" })
  ).toBeChecked();
});

test("doesn't poll while an answer is being saved", async ({ page }) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await createGroup(page, "Me");
  await findMovie(page, comedy);

  // Hold the next save until the test lets it through; count polls.
  const gate = Promise.withResolvers<undefined>();
  await page.route(
    (url) => url.searchParams.has("/answer"),
    async (route) => {
      await gate.promise;
      await route.continue();
    }
  );
  let polls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/poll?")) polls += 1;
  });

  await answer(page, "Not seen");
  await expect(page.getByText("Saving…")).toBeVisible();
  // Several poll intervals pass with the save out: no polls.
  await page.waitForTimeout(6000);
  expect(polls).toBe(0);

  // Once it's answered, polling resumes.
  gate.resolve(undefined);
  await expect(page.getByText("Saving…")).toBeHidden();
  await expect.poll(() => polls, LIVE).toBeGreaterThan(0);
});

test("leaving the deck waits for answers still being saved", async ({
  page,
}) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await createGroup(page, "Me");
  await findMovie(page, horror);
  await expect(card(page)).toHaveText(title(horror, 0));

  // Slow down the first save so the second answer is still queued (not yet
  // sent) when the person taps Matches.
  await page.route(
    (url) => url.searchParams.has("/answer"),
    async (route) => {
      await new Promise((done) => setTimeout(done, 1000));
      await route.continue();
    },
    { times: 1 }
  );
  await answer(page, "Not seen");
  await answer(page, "Not seen");
  await page.getByRole("link", { name: /^Matches/ }).click();

  await expect(page).toHaveURL(/\/matches(\?|$)/);
  await expect(matchRows(page)).toHaveCount(2);
});

test("old session links go home", async ({ page }) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await page.goto(`/sessions/${crypto.randomUUID()}`);
  await expect(page).toHaveURL("/");
});

test("signing out elsewhere takes the deck to sign-in", async ({ page }) => {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  await createGroup(page, "Me");
  await findMovie(page, comedy);

  // The login session ends (expired, or signed out on another tab): the
  // next poll is redirected, and the page follows it to sign-in.
  await page.context().clearCookies();
  await expect(page).toHaveURL(/\/sign-in/, LIVE);
});
