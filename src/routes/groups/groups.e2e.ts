import { randomInt } from "node:crypto";

import { type Browser, expect, type Page, test } from "@playwright/test";
import { inArray } from "drizzle-orm";

import { groups } from "#lib/server/db/schema.ts";
import { connectTestDb } from "#lib/server/testing/db.ts";
import {
  deleteAccount,
  readSignInCode,
  signIn,
} from "#lib/server/testing/sign-in.ts";

const { pool, db } = connectTestDb();

const runId = `e2e-${crypto.randomUUID()}`;
const emails: string[] = [];
const groupIds: string[] = [];

test.afterAll(async () => {
  // Deleting the accounts removes memberships, not the groups themselves.
  if (groupIds.length > 0) {
    await db.delete(groups).where(inArray(groups.id, groupIds));
  }
  for (const email of emails) await deleteAccount(db, email);
  await pool.end();
});

// Each person gets their own browser context: separate cookies, so separate
// accounts, like two phones. And their own client IP, so this file's sign-ins
// don't share one per-IP code limit (10 per 10 minutes).
async function newBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`,
    },
  });
  return context.newPage();
}

function newEmail(): string {
  const email = `${runId}-${String(emails.length)}@example.test`;
  emails.push(email);
  return email;
}

async function newPerson(browser: Browser): Promise<Page> {
  const page = await newBrowser(browser);
  await signIn(page, db, newEmail());
  return page;
}

async function createGroup(page: Page, name: string, nickname: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "New group" }).click();
  await page.getByLabel("Group name").fill(name);
  await page.getByLabel("What should this group call you?").fill(nickname);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  const groupId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  groupIds.push(groupId);
  const code = await page.getByLabel("Invite code").textContent();
  return { groupId, code: code?.trim() ?? "" };
}

function membersList(page: Page) {
  return page.getByRole("region", { name: /Members/ }).getByRole("listitem");
}

test("a second account joins by link, a third by code", async ({ browser }) => {
  const owner = await newPerson(browser);
  const { groupId, code } = await createGroup(owner, "Movie night", "Joe");
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // By link: the invite page names the group and asks for a nickname.
  const friend = await newPerson(browser);
  await friend.goto(`/join/${code}`);
  await expect(
    friend.getByRole("heading", { name: "Join Movie night?" })
  ).toBeVisible();
  // Someone already goes by "Joe" (ignoring case).
  await friend.getByLabel("What should this group call you?").fill("joe");
  await friend.getByRole("button", { name: "Join group" }).click();
  await expect(friend.getByRole("alert")).toHaveText(
    "Someone in this group already goes by that name."
  );
  await friend.getByLabel("What should this group call you?").fill("Sam");
  await friend.getByRole("button", { name: "Join group" }).click();
  await expect(friend).toHaveURL(`/groups/${groupId}`);
  await expect(membersList(friend)).toHaveText([
    /Joe\s+Owner/,
    /Sam\s+\(you\)/,
  ]);

  // By code, typed loosely on the home page.
  const third = await newPerson(browser);
  await third
    .getByLabel("Join with a code")
    .fill(`${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`);
  // Lowercase and the space are cleaned up as it's typed.
  await expect(third.getByLabel("Join with a code")).toHaveValue(code);
  await third.getByRole("button", { name: "Join", exact: true }).click();
  await expect(third).toHaveURL(`/join/${code}`);
  // The nickname field remembers nothing yet for a new account.
  await third.getByLabel("What should this group call you?").fill("Alex");
  await third.getByRole("button", { name: "Join group" }).click();
  await expect(membersList(third)).toHaveCount(3);

  // The owner sees everyone after a reload and removes Alex.
  await owner.reload();
  await expect(membersList(owner)).toHaveCount(3);
  owner.once("dialog", (dialog) => void dialog.accept());
  await owner.getByRole("button", { name: "Remove Alex" }).click();
  await expect(membersList(owner)).toHaveCount(2);

  // Alex can no longer see the group.
  const response = await third.goto(`/groups/${groupId}`);
  expect(response?.status()).toBe(404);
});

test("a non-member gets the same 404 as for a missing group", async ({
  browser,
}) => {
  const owner = await newPerson(browser);
  const { groupId } = await createGroup(owner, "Private", "Owner");

  const stranger = await newPerson(browser);
  const theirs = await stranger.goto(`/groups/${groupId}`);
  const missing = await stranger.goto(`/groups/${crypto.randomUUID()}`);
  expect(theirs?.status()).toBe(404);
  expect(missing?.status()).toBe(404);

  // Posting a change directly is refused too, and changes nothing.
  const rename = await stranger.request.post(`/groups/${groupId}?/rename`, {
    form: { actionId: crypto.randomUUID(), name: "Taken over" },
    headers: {
      accept: "application/json",
      origin: new URL(stranger.url()).origin,
    },
  });
  expect(rename.status()).toBe(404);
  await owner.reload();
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText("Private");
});

test("leaving hands ownership on; the owner can reset the invite", async ({
  browser,
}) => {
  const owner = await newPerson(browser);
  const { groupId, code } = await createGroup(owner, "Handoff", "First");
  const friend = await newPerson(browser);
  await friend.goto(`/join/${code}`);
  await friend.getByLabel("What should this group call you?").fill("Second");
  await friend.getByRole("button", { name: "Join group" }).click();
  await expect(friend).toHaveURL(`/groups/${groupId}`);

  // Group pages don't update live: the confirm names the next owner from
  // the page's data. (The server decides under the group's lock either way.)
  await owner.reload();
  owner.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Second will become the owner");
    void dialog.accept();
  });
  await owner.getByRole("button", { name: "Leave group" }).click();
  await expect(owner).toHaveURL("/");
  await expect(owner.getByText("You're not in a group yet.")).toBeVisible();

  await friend.reload();
  await expect(membersList(friend)).toHaveText([/Second\s+\(you\)\s+Owner/]);
  friend.once("dialog", (dialog) => void dialog.accept());
  await friend.getByRole("button", { name: "Reset invite" }).click();
  await expect(friend.getByLabel("Invite code")).not.toHaveText(code);

  // The old code is dead: a link shows the same message as a wrong code,
  // with the code form to try another.
  await owner.goto(`/join/${code}`);
  await expect(owner.getByRole("alert")).toHaveText(
    "That's not an active invite code."
  );

  // Typed on the home page, it stays there with the same message.
  await owner.goto("/");
  const input = owner.getByLabel("Join with a code");
  await input.fill(code);
  await owner.getByRole("button", { name: "Join", exact: true }).click();
  await expect(owner.getByRole("alert")).toHaveText(
    "That's not an active invite code."
  );
  await expect(owner).toHaveURL("/");
  await expect(input).toHaveValue(code);
});

test("an invite link survives signing in first", async ({ browser }) => {
  const owner = await newPerson(browser);
  const { groupId, code } = await createGroup(owner, "Newcomers", "Host");

  // Someone without an account taps the link: sign in, then back to it.
  const newcomer = await newBrowser(browser);
  await newcomer.goto(`/join/${code}`);
  await expect(newcomer).toHaveURL(/\/sign-in\?/);
  const email = newEmail();
  await newcomer.getByLabel("Email").fill(email);
  await newcomer.getByRole("button", { name: "Email me a code" }).click();
  await expect(newcomer.getByText("We sent a 6-digit code")).toBeVisible();
  await newcomer.getByLabel("Code").fill(await readSignInCode(db, email));
  await newcomer.getByRole("button", { name: "Sign in" }).click();

  await expect(newcomer).toHaveURL(`/join/${code}`);
  await newcomer.getByLabel("What should this group call you?").fill("New");
  await newcomer.getByRole("button", { name: "Join group" }).click();
  await expect(newcomer).toHaveURL(`/groups/${groupId}`);
});
