import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { connectTestDb } from "#lib/server/testing/db.ts";
import { deleteAccount, signIn } from "#lib/server/testing/sign-in.ts";

const { pool, db } = connectTestDb();
const email = `e2e-reload-${crypto.randomUUID()}@example.test`;

test.beforeEach(async ({ page }) => {
  // Sign-in limits count per address; each run looks like a new one.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`,
  });
});

test.afterAll(async () => {
  await deleteAccount(db, email);
  await pool.end();
});

test("icons are drawn before the app's code loads", async ({ page }) => {
  await signIn(page, db, email);

  // With every app script blocked, the page shows only what the server sent:
  // the first paint, before hydration.
  let blocked = 0;
  await page.route("**/_app/immutable/**/*.js", (route) => {
    blocked += 1;
    return route.abort();
  });
  await page.reload();

  const seenIcon = page
    .getByRole("link", { name: /Seen movies/ })
    .locator("svg path")
    .first();
  await expect(seenIcon).toHaveAttribute("d", /\S/);
  expect(blocked).toBeGreaterThan(0);
});
