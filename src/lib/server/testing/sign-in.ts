import { expect, type Page } from "@playwright/test";
import { symmetricDecrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import type { Db } from "#lib/server/db/client.ts";
import {
  signInCodeLimits,
  users,
  verifications,
} from "#lib/server/db/schema.ts";

import { TEST_AUTH_SECRET } from "./environment.ts";
import { visit } from "./visit.ts";

// Sign-in helpers for end-to-end tests. Locally codes aren't emailed, so tests
// read them from the database.

/**
 * Reads the code the server just created for `email`. Coupled to Better
 * Auth 1.7.7's storage format (identifier "sign-in-otp-<email>", value
 * "<encrypted-code>:<attempts>", with newest created_at winning). Only the
 * isolated browser server uses TEST_AUTH_SECRET; never read live OTPs here.
 */
export async function readSignInCode(db: Db, email: string): Promise<string> {
  const row = await db.query.verifications.findFirst({
    where: { identifier: `sign-in-otp-${email}` },
    orderBy: { createdAt: "desc" },
  });
  const value = row?.value.split(":")[0];
  if (value === undefined) {
    throw new Error(`No sign-in code stored for ${email}.`);
  }
  const code = await symmetricDecrypt({ key: TEST_AUTH_SECRET, data: value });
  if (!/^\d{6}$/.test(code)) throw new Error("Invalid test sign-in code.");
  return code;
}

/** Signs in through the sign-in page, creating the account if it's new. */
export async function signIn(page: Page, db: Db, email: string): Promise<void> {
  // The form signs in only once the app's code runs; a click before that
  // posts it to a page with no action.
  await visit(page, "/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  // The sixth digit submits the code; there's no button to press.
  await page.getByLabel("Code").fill(await readSignInCode(db, email));
  await expect(page).toHaveURL("/");
}

/**
 * Deletes what signing in with `email` left behind. Deleting the user cascades
 * to their sessions and data; codes and limits aren't linked to users.
 */
export async function deleteAccount(db: Db, email: string): Promise<void> {
  await db.delete(users).where(eq(users.email, email));
  await db
    .delete(verifications)
    .where(eq(verifications.identifier, `sign-in-otp-${email}`));
  await db.delete(signInCodeLimits).where(eq(signInCodeLimits.email, email));
}
