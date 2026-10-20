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

test("a reload paints in place, icons and scroll position included", async ({
  page,
}) => {
  // Short enough that the home page scrolls.
  await page.setViewportSize({ width: 390, height: 480 });
  await signIn(page, db, email);
  await page.evaluate(() => {
    scrollTo(
      0,
      Math.round((document.documentElement.scrollHeight - innerHeight) / 2)
    );
  });
  const scrolled = await page.evaluate(() => scrollY);
  expect(scrolled).toBeGreaterThan(20);

  // With every app script blocked, the page shows only what the browser does
  // on its own before the app's code loads: the first paint.
  let blocked = 0;
  // Where the page is when its HTML is parsed, before the first paint.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.dataset.parsedScrollY = String(scrollY);
    });
  });
  await page.route("**/_app/immutable/**/*.js", (route) => {
    blocked += 1;
    return route.abort();
  });
  await page.reload();

  // Icons are drawn in the server's HTML, not filled in after hydration.
  const seenIcon = page
    .getByRole("link", { name: /Seen movies/ })
    .locator("svg path")
    .first();
  await expect(seenIcon).toHaveAttribute("d", /\S/);

  // The page is already where it was scrolled, instead of drawing the top
  // and waiting for the app's code to jump down.
  await expect(page.locator("html")).toHaveAttribute(
    "data-parsed-scroll-y",
    String(scrolled)
  );
  expect(blocked).toBeGreaterThan(0);
});
