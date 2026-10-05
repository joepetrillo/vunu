import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { signInCodeLimits } from "#lib/server/db/schema.ts";
import {
  consumeSignInCodeRequest,
  MAX_CODES_PER_EMAIL,
  WINDOW_MINUTES,
} from "#lib/server/sign-in-code-limit.ts";
import { connectTestDb } from "#lib/server/testing/db.ts";

const { pool, db } = connectTestDb();
const emails: string[] = [];
function address() {
  const email = `${crypto.randomUUID()}@example.test`;
  emails.push(email);
  return email;
}

afterAll(async () => {
  if (emails.length > 0)
    await db
      .delete(signInCodeLimits)
      .where(inArray(signInCodeLimits.email, emails));
  await pool.end();
});

describe("per-email code request limits", () => {
  it("admits only three concurrent requests for one inbox", async () => {
    const email = address();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeSignInCodeRequest(db, email))
    );
    expect(results.filter(Boolean)).toHaveLength(MAX_CODES_PER_EMAIL);
  });

  it("starts a new window without extending the old one on refusal", async () => {
    const email = address();
    for (let i = 0; i < MAX_CODES_PER_EMAIL; i++)
      await consumeSignInCodeRequest(db, email);
    const before = await db.query.signInCodeLimits.findFirst({
      where: { email },
    });
    expect(await consumeSignInCodeRequest(db, email)).toBe(false);
    const refused = await db.query.signInCodeLimits.findFirst({
      where: { email },
    });
    expect(refused?.windowStartedAt).toEqual(before?.windowStartedAt);

    await db
      .update(signInCodeLimits)
      .set({
        windowStartedAt: new Date(
          Date.now() - (WINDOW_MINUTES * 60 + 1) * 1000
        ),
      })
      .where(eq(signInCodeLimits.email, email));
    expect(await consumeSignInCodeRequest(db, email)).toBe(true);
    const reset = await db.query.signInCodeLimits.findFirst({
      where: { email },
    });
    expect(reset?.count).toBe(1);
  });
});
