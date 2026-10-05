import { sql } from "drizzle-orm";

import type { Db } from "#lib/server/db/client.ts";
import { signInCodeLimits } from "#lib/server/db/schema.ts";

export const MAX_CODES_PER_EMAIL = 3;
export const WINDOW_MINUTES = 10;

/**
 * Records one code request for `email` and reports whether it's within the
 * limit. Stops someone from flooding one inbox from any number of IPs.
 * A refused request never reaches the plugin or changes the pending code.
 */
export async function consumeSignInCodeRequest(
  db: Db,
  email: string
): Promise<boolean> {
  const { count, windowStartedAt } = signInCodeLimits;
  const windowOver = sql`${windowStartedAt} < now() - make_interval(mins => ${WINDOW_MINUTES})`;
  // One atomic statement: concurrent requests for the same address queue on
  // the row lock, so each sees the previous one's count and none slip through.
  // Every SET expression reads the row's old values.
  const [row] = await db
    .insert(signInCodeLimits)
    .values({ email, windowStartedAt: sql`now()`, count: 1 })
    .onConflictDoUpdate({
      target: signInCodeLimits.email,
      set: {
        count: sql`case when ${windowOver} then 1 else ${count} + 1 end`,
        windowStartedAt: sql`case when ${windowOver} then now() else ${windowStartedAt} end`,
      },
    })
    .returning({ count });
  return row !== undefined && row.count <= MAX_CODES_PER_EMAIL;
}
