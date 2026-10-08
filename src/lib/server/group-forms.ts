import { type ActionFailure, fail } from "@sveltejs/kit";
import type { z } from "zod";

import type { GroupOutcome } from "#lib/server/groups.ts";

// Shared by the group pages' form actions.

const RELOAD = "Something went wrong. Reload the page and try again.";

/**
 * The form's fields, validated, or a failure to return from the action.
 * Field errors (an empty nickname, say) carry the schema's own message.
 */
export async function readForm<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<
  | { ok: true; data: z.output<T> }
  | { ok: false; failure: ActionFailure<{ message: string }> }
> {
  // Malformed multipart bodies can fail before Zod sees any fields.
  const fields = await request.formData().catch((error: unknown) => {
    if (error instanceof TypeError) return null;
    throw error;
  });
  const form = schema.safeParse(
    fields === null ? null : Object.fromEntries(fields)
  );
  if (form.success) return { ok: true, data: form.data };
  // A hidden field (an ID) failing means a bug or a tampered request, so
  // only show messages written for people.
  const issue = form.error.issues[0];
  const message =
    issue?.code === "too_small" || issue?.code === "too_big"
      ? issue.message
      : RELOAD;
  return { ok: false, failure: fail(400, { message }) };
}

const refusals: Record<
  Exclude<GroupOutcome, "applied" | "duplicate">,
  [status: number, message: string]
> = {
  not_found: [404, "This group is gone, or you're no longer in it."],
  not_owner: [403, "Only the group's owner can do that."],
  nickname_taken: [409, "Someone in this group already goes by that name."],
  group_full: [409, "This group is full."],
  invite_invalid: [
    404,
    "This invite doesn't work anymore. Ask someone in the group for a new one.",
  ],
  too_many_lookups: [
    429,
    "Too many invite attempts. Wait a few minutes and try again.",
  ],
  cannot_remove_self: [400, "To leave the group, use Leave group."],
  // Only a bug or a tampered request reuses an action ID for something else.
  conflict: [409, RELOAD],
};

/**
 * Null when the change is saved ("applied", or "duplicate": a retry of one
 * that already succeeded); otherwise the failure to return.
 */
export function refusal(
  outcome: GroupOutcome
): ActionFailure<{ message: string }> | null {
  if (outcome === "applied" || outcome === "duplicate") return null;
  const [status, message] = refusals[outcome];
  return fail(status, { message });
}

/** Shown on pages (not forms) for the same refusals. */
export function refusalMessage(
  outcome: Exclude<GroupOutcome, "applied" | "duplicate">
): string {
  return refusals[outcome][1];
}
