import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { actions, seenMovies, users } from "#lib/server/db/schema.ts";
import { addToSeenList } from "#lib/server/seen-list.ts";
import {
  connectTestDb,
  createFixtures,
  testMovieId,
} from "#lib/server/testing/db.ts";
import { deleteAccount, signIn } from "#lib/server/testing/sign-in.ts";

const { pool, db } = connectTestDb();
const fixtures = createFixtures(db);

const runId = `e2e-${crypto.randomUUID()}`;
// A title only this run's movie has, so searching for the run ID finds it alone.
const title = `Vunu test movie ${runId}`;
const emails: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`,
  });
});

test.beforeAll(async () => {
  await fixtures.movie({ title, releaseDate: "1999-03-31" });
});

test.afterAll(async () => {
  for (const email of emails) await deleteAccount(db, email);
  await fixtures.cleanUp();
  await pool.end();
});

// Each test signs in as a new user, so their seen lists start empty.
async function signInAsNewUser(page: Page): Promise<string> {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  await signIn(page, db, email);
  return email;
}

async function searchAllMovies(page: Page): Promise<void> {
  await page.goto("/seen?scope=all");
  await page.getByRole("searchbox", { name: "Title" }).fill(runId);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(`/seen?scope=all&title=${runId}`);
}

test("adds a movie to the seen list and removes it", async ({ page }) => {
  await signInAsNewUser(page);
  await page.goto("/seen");
  await expect(page.getByText("Nothing here yet")).toBeVisible();

  await searchAllMovies(page);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: `Seen it: ${title}` }).click();

  // Saved, and the search is still there.
  await expect(row.getByText("1999 · Seen")).toBeVisible();
  await page.reload();
  await expect(row.getByText("1999 · Seen")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Title" })).toHaveValue(
    runId
  );

  // Switching to your list keeps the search.
  await page.getByRole("link", { name: "Your list (1)" }).click();
  await expect(page).toHaveURL(`/seen?title=${runId}`);
  await row.getByRole("button", { name: `Remove ${title}` }).click();

  await expect(page.getByText("No movies match.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Your list (0)" })).toBeVisible();
});

function postAction(
  page: Page,
  change: "add" | "remove",
  fields: Record<string, string>,
  origin = "http://localhost:4173"
) {
  return page.request.post(`/seen?/${change}`, {
    form: fields,
    headers: {
      origin,
      accept: "application/json",
      "x-sveltekit-action": "true",
    },
    maxRedirects: 0,
  });
}

test("protects direct action requests before any mutation", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  const response = await postAction(page, "add", {
    actionId: id,
    movieId: String(testMovieId()),
  });
  // Kit 3 represents an enhanced redirect in a 200 action envelope.
  expect(response.status()).toBe(200);
  const result: unknown = await response.json();
  expect(result).toEqual({
    type: "redirect",
    status: 303,
    location: "/sign-in?redirectTo=%2Fseen",
  });
  const plain = await page.request.post("/seen?/add", {
    form: { actionId: id, movieId: String(testMovieId()) },
    headers: { origin: "http://localhost:4173", accept: "text/html" },
    maxRedirects: 0,
  });
  expect(plain.status()).toBe(303);
  expect(plain.headers().location).toBe("/sign-in?redirectTo=%2Fseen");
  expect(await db.$count(actions, eq(actions.id, id))).toBe(0);
});

test("validates action inputs and reports a missing catalog movie without a 500", async ({
  page,
}) => {
  await signInAsNewUser(page);
  for (const fields of [
    { actionId: "not-a-uuid", movieId: "1" },
    { actionId: crypto.randomUUID(), movieId: "2147483648" },
    { actionId: crypto.randomUUID(), movieId: "0" },
    { actionId: crypto.randomUUID(), movieId: "not-a-number" },
  ]) {
    const response = await postAction(page, "add", fields);
    expect(response.status()).toBe(400);
  }
  const malformed = await page.request.post("/seen?/add", {
    data: "invalid multipart body",
    headers: {
      origin: "http://localhost:4173",
      accept: "application/json",
      "content-type": "multipart/form-data; boundary=vunu-audit",
      "x-sveltekit-action": "true",
    },
  });
  expect(malformed.status()).toBe(400);
  const id = crypto.randomUUID();
  const missing = await postAction(page, "add", {
    actionId: id,
    movieId: String(testMovieId()),
  });
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("no longer in the catalog");
  expect(await db.$count(actions, eq(actions.id, id))).toBe(0);
});

test("uses the session user, rejects another user's action ID, and blocks cross-origin writes", async ({
  page,
}) => {
  const email = await signInAsNewUser(page);
  const actor = await db.query.users.findFirst({ where: { email } });
  if (actor === undefined)
    throw new Error("Test sign-in did not create a user.");
  const otherUserId = await fixtures.user();
  const movieId = await fixtures.movie();
  const ownedId = crypto.randomUUID();
  await addToSeenList(db, { actionId: ownedId, userId: otherUserId, movieId });

  const conflict = await postAction(page, "add", {
    actionId: ownedId,
    movieId: String(movieId),
  });
  expect(conflict.status()).toBe(409);
  expect(await db.$count(seenMovies, eq(seenMovies.userId, actor.id))).toBe(0);

  const id = crypto.randomUUID();
  const rejected = await postAction(
    page,
    "remove",
    { actionId: id, movieId: String(movieId) },
    "https://evil.example"
  );
  expect(rejected.status()).toBe(403);
  expect(await db.$count(actions, eq(actions.id, id))).toBe(0);

  const saved = await postAction(page, "add", {
    actionId: id,
    movieId: String(movieId),
    userId: otherUserId,
  });
  expect(saved.status()).toBe(200);
  const logged = await db.query.actions.findFirst({ where: { id } });
  expect(logged?.userId).toBe(actor.id);
  expect(await db.$count(seenMovies, eq(seenMovies.userId, otherUserId))).toBe(
    1
  );

  const response = await page.goto("/seen");
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  await expect(page.getByRole("link", { name: "Your list (1)" })).toBeVisible();
});

test("shows sign-out failures and permits retry", async ({ page }) => {
  await signInAsNewUser(page);
  await page.route(
    "**/api/auth/sign-out",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Temporarily unavailable" }),
      }),
    { times: 1 }
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Couldn't sign out/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
});

test("doesn't let a stale action parameter override the next change", async ({
  page,
}) => {
  await signInAsNewUser(page);
  await page.goto(`/seen?scope=all&title=${runId}&/remove`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: `Seen it: ${title}` }).click();
  await expect(row.getByText("1999 · Seen")).toBeVisible();
  await page.goto(`/seen?scope=all&title=${runId}&/add`);
  await row.getByRole("button", { name: `Remove ${title}` }).click();
  await expect(
    row.getByRole("button", { name: `Seen it: ${title}` })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Your list (0)" })).toBeVisible();
});

test("falls back on malformed filters and unsafe page arithmetic", async ({
  page,
}) => {
  await signInAsNewUser(page);
  await page.goto(
    `/seen?scope=all&title=${runId}&genre=&decade=invalid&page=9007199254740991`
  );
  await expect(page.getByRole("combobox", { name: "Genre" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Decade" })).toHaveValue("");
  await expect(page.getByText("No more movies.")).not.toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: title })
  ).toBeVisible();
});

test("a retry after a lost response doesn't save the change twice", async ({
  page,
}) => {
  const email = await signInAsNewUser(page);
  await searchAllMovies(page);

  // The first save reaches the server, but its response never reaches the
  // browser: the classic case where the browser can't know it worked.
  await page.route(
    (url) => url.searchParams.has("/add"),
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 }
  );
  const row = page.getByRole("listitem").filter({ hasText: title });
  const seenIt = row.getByRole("button", { name: `Seen it: ${title}` });
  await seenIt.click();
  await expect(row.getByRole("alert")).toHaveText(/Couldn't save/);

  // Trying again resends the same action ID, which the server recognizes.
  await seenIt.click();
  await expect(row.getByText("1999 · Seen")).toBeVisible();

  const logged = await db
    .select({ type: actions.type, seenVersion: users.seenVersion })
    .from(actions)
    .innerJoin(users, eq(users.id, actions.userId))
    .where(eq(users.email, email));
  expect(logged).toEqual([{ type: "seen_list_add", seenVersion: 1 }]);
});
import { randomInt } from "node:crypto";
