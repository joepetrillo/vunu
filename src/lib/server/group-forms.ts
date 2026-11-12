import { type ActionFailure, fail, redirect } from "@sveltejs/kit";
import { z } from "zod";

import { inviteCodeSchema } from "#lib/group-fields.ts";
import { db } from "#lib/server/db/index.ts";
import { readFields, readForm, RELOAD } from "#lib/server/forms.ts";
import { type GroupOutcome, previewInvite } from "#lib/server/groups.ts";
import { requireUser } from "#lib/server/require-user.ts";

// Shared by the group pages' form actions.

export const INACTIVE_CODE = "That's not an active invite code.";

const refusals: Record<
  Exclude<GroupOutcome, "applied" | "duplicate">,
  [status: number, message: string]
> = {
  not_found: [404, "This group is gone, or you're no longer in it."],
  not_owner: [403, "Only the group's owner can do that."],
  nickname_taken: [409, "Someone in this group already goes by that name."],
  group_full: [409, "This group is full."],
  // One answer for a mistyped, malformed, or reset code: telling them apart
  // wouldn't help the person, and a reset code is simply no longer active.
  invite_invalid: [404, INACTIVE_CODE],
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

/**
 * The invite code form's action (the Join a group page and dead invite links).
 * A code that works goes to its invite page (or straight to the group for a
 * member); anything else stays on the form with one message. Answers with
 * `codeError` so it can't be confused with another form's `message`.
 */
export async function findInvite({
  request,
  locals,
}: {
  request: Request;
  locals: App.Locals;
}) {
  const user = requireUser(locals);
  const fields = await readFields(request);
  const code = inviteCodeSchema.safeParse(fields?.get("code"));
  if (!code.success) return fail(400, { codeError: INACTIVE_CODE });

  const preview = await previewInvite(db, user.id, code.data);
  if (preview.status !== "found") {
    return fail(refusals[preview.status][0], {
      codeError: refusals[preview.status][1],
    });
  }
  redirect(
    303,
    preview.isMember ? `/groups/${preview.id}` : `/join/${code.data}`
  );
}

/** What a group screen's form action needs from Kit's request event. */
export interface GroupActionEvent {
  request: Request;
  locals: App.Locals;
  params: { groupId: string };
}

/**
 * Runs one group change from a group screen's form: reads the form, then
 * applies `change` to the group in the URL as the signed-in user. Leaving
 * or deleting ends on the home page; everything else reloads the screen.
 */
export async function groupAction<T extends z.ZodObject>(
  { request, locals, params }: GroupActionEvent,
  schema: T,
  change: (
    input: z.output<T> & { userId: string; groupId: string }
  ) => Promise<GroupOutcome>,
  { thenHome = false } = {}
) {
  const user = requireUser(locals);
  const groupId = z.uuid().safeParse(params.groupId);
  if (!groupId.success) {
    return fail(404, { message: refusalMessage("not_found") });
  }
  const form = await readForm(request, schema);
  if (!form.ok) return form.failure;

  const failed = refusal(
    await change({ ...form.data, userId: user.id, groupId: groupId.data })
  );
  if (failed !== null) return failed;
  if (thenHome) redirect(303, "/");
}
