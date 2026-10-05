import { expect, test } from "@playwright/test";

import { MAX_CODES_PER_EMAIL } from "#lib/server/sign-in-code-limit.ts";
import { connectTestDb } from "#lib/server/testing/db.ts";
import { deleteAccount, readSignInCode } from "#lib/server/testing/sign-in.ts";

const { pool, db } = connectTestDb();

// Fresh addresses per run, on a reserved domain that can't receive mail.
const runId = `e2e-${crypto.randomUUID()}`;
const email = `${runId}@example.test`;
const limitedEmail = `${runId}-limited@example.test`;
const extraEmails: string[] = [];

function freshEmail() {
  const address = `${crypto.randomUUID()}@example.test`;
  extraEmails.push(address);
  return address;
}

test.beforeEach(async ({ page }) => {
  // Each test gets its own IP bucket while still exercising real rate limits.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`,
  });
});

test.afterAll(async () => {
  await deleteAccount(db, email);
  await deleteAccount(db, limitedEmail);
  for (const address of extraEmails) await deleteAccount(db, address);
  await pool.end();
});

test("keeps the email fixed during a send and focuses the code input", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/auth/email-otp/send-verification-otp",
    async (route) => {
      await held;
      await route.continue();
    },
    { times: 1 }
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(freshEmail());
  await page.getByRole("button", { name: "Email me a code" }).click();
  try {
    await expect(page.getByLabel("Email")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Sending…" })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByLabel("Code")).toBeFocused();
});

test("prevents switching email during a resend and restores focus afterwards", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(freshEmail());
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/auth/email-otp/send-verification-otp",
    async (route) => {
      await held;
      await route.continue();
    },
    { times: 1 }
  );
  await page.getByRole("button", { name: "send it again" }).click();
  try {
    await expect(
      page.getByRole("button", { name: "Use a different email" })
    ).toBeDisabled();
    await expect(page.getByLabel("Code")).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole("status")).toHaveText(/Sent/);
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email")).toBeFocused();
});

test("recovers after the send request can't reach the server", async ({
  page,
}) => {
  await page.route(
    "**/api/auth/email-otp/send-verification-otp",
    (route) => route.abort(),
    { times: 1 }
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(freshEmail());
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Couldn't reach/);
  await expect(page.getByLabel("Email")).toBeEnabled();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();
});

test("keeps sensitive form fields out of the URL before hydration", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:4173/sign-in");
    await page.getByLabel("Email").fill("no-js@example.test");
    const request = page.waitForRequest(
      (request) => request.method() === "POST"
    );
    await page.getByRole("button", { name: "Email me a code" }).click();
    const submitted = await request;
    expect(submitted.url()).toBe("http://localhost:4173/sign-in");
    expect(new URLSearchParams(submitted.postData() ?? "").get("email")).toBe(
      "no-js@example.test"
    );
  } finally {
    await context.close();
  }
});

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/seen");
  await expect(page).toHaveURL("/sign-in?redirectTo=%2Fseen");
});

test("signs in with an emailed code and returns to the requested page", async ({
  page,
}) => {
  await page.goto("/seen");

  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();

  const code = await readSignInCode(db, email);

  // Asking again re-sends the same code, so the first email still works.
  await page.getByRole("button", { name: "send it again" }).click();
  await expect(page.getByRole("status")).toHaveText(/Sent/);
  expect(await readSignInCode(db, email)).toBe(code);

  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/seen");

  // Signing out ends the session: protected pages redirect again.
  await page.goto("/");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.goto("/seen");
  await expect(page).toHaveURL(/\/sign-in\?/);
});

test("refuses more codes for one email within the limit window", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(limitedEmail);
  const sendCode = page.getByRole("button", { name: "Email me a code" });

  for (let i = 0; i < MAX_CODES_PER_EMAIL; i++) {
    await sendCode.click();
    await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
    // Goes back to the email step; the address stays filled in.
    await page.getByRole("button", { name: "Use a different email" }).click();
  }

  await sendCode.click();
  await expect(page.getByRole("alert")).toHaveText(/Too many attempts/);
});
import { randomInt } from "node:crypto";
