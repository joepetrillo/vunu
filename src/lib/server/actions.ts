import type { Db, Transaction } from "#lib/server/db/client.ts";
import { type ActionType, actions } from "#lib/server/db/schema.ts";

/**
 * A change a user asked for, under the ID their browser generated for it.
 * Each type sets the inputs it has; the others stay unset (null in the log).
 */
export interface Action {
  id: string;
  userId: string;
  type: ActionType;
  movieId?: number;
  groupId?: string;
  memberId?: string;
  groupName?: string;
  nickname?: string;
}

type LoggedAction = typeof actions.$inferSelect;

// Every input column. A retry must match all of them: the same ID with a
// different nickname, say, is a different action.
const inputs = [
  "movieId",
  "groupId",
  "memberId",
  "groupName",
  "nickname",
] as const satisfies readonly (keyof Action & keyof LoggedAction)[];

/**
 * - `applied`: the change was made.
 * - `duplicate`: this exact action already succeeded (a retry); nothing changed.
 * - `conflict`: the ID belongs to a different action; nothing changed.
 */
export type ActionOutcome = "applied" | "duplicate" | "conflict";

/**
 * Makes a change at most once per action ID. The action is logged and `apply`
 * runs in the same transaction, so either both happen or neither does: a
 * failed change leaves no log entry, and its retry runs normally.
 */
export async function runAction(
  db: Db,
  action: Action,
  apply: (tx: Transaction) => Promise<void>
): Promise<ActionOutcome> {
  return db.transaction(async (tx) => {
    // If a request with the same ID is still in flight (a double submit), this
    // waits until its transaction ends, then sees its row. So a double submit
    // is applied once, never twice.
    const [logged] = await tx
      .insert(actions)
      .values(action)
      .onConflictDoNothing({ target: actions.id })
      .returning({ id: actions.id });

    if (logged === undefined) {
      const existing = await tx.query.actions.findFirst({
        where: { id: action.id },
      });
      return existing !== undefined && isSameAction(existing, action)
        ? "duplicate"
        : "conflict";
    }

    await apply(tx);
    return "applied";
  });
}

// Includes the user: an ID taken from someone else's request is a conflict,
// never a successful retry.
function isSameAction(logged: LoggedAction, action: Action): boolean {
  return (
    logged.userId === action.userId &&
    logged.type === action.type &&
    inputs.every((input) => logged[input] === (action[input] ?? null))
  );
}
