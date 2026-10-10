import { error, fail, redirect } from "@sveltejs/kit";
import { z } from "zod";

import { groupNameSchema, nicknameSchema } from "#lib/group-fields.ts";
import { db } from "#lib/server/db/index.ts";
import { readForm, refusal, refusalMessage } from "#lib/server/group-forms.ts";
import {
  deleteGroup,
  getGroupForMember,
  type GroupOutcome,
  leaveGroup,
  removeMember,
  renameGroup,
  resetInvite,
  setNickname,
} from "#lib/server/groups.ts";
import { requireUser } from "#lib/server/require-user.ts";

import type { Actions, PageServerLoad, RequestEvent } from "./$types";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const user = requireUser(locals);
  const groupId = z.uuid().safeParse(params.groupId);
  const group = groupId.success
    ? await getGroupForMember(db, groupId.data, user.id)
    : null;
  // Same answer for "no such group" and "not your group", so a stranger
  // can't learn which IDs exist.
  if (group === null) error(404, "Group not found.");
  return {
    group,
    inviteUrl: `${url.origin}/join/${group.inviteCode}`,
  };
};

// Better Auth's user IDs are random letters and digits.
const memberIdSchema = z.string().regex(/^[\w-]{1,64}$/);

/**
 * Runs one of this page's changes: reads the form, then applies `change` to
 * the group in the URL as the signed-in user. Leaving or deleting ends on
 * the home page; everything else reloads this one.
 */
async function groupAction<T extends z.ZodObject>(
  { request, locals, params }: RequestEvent,
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

const actionId = z.uuid();

export const actions = {
  rename: (event) =>
    groupAction(event, z.object({ actionId, name: groupNameSchema }), (input) =>
      renameGroup(db, input)
    ),
  nickname: (event) =>
    groupAction(
      event,
      z.object({ actionId, nickname: nicknameSchema }),
      (input) => setNickname(db, input)
    ),
  resetInvite: (event) =>
    groupAction(event, z.object({ actionId }), (input) =>
      resetInvite(db, input)
    ),
  removeMember: (event) =>
    groupAction(
      event,
      z.object({ actionId, memberId: memberIdSchema }),
      (input) => removeMember(db, input)
    ),
  leave: (event) =>
    groupAction(
      event,
      z.object({ actionId }),
      (input) => leaveGroup(db, input),
      {
        thenHome: true,
      }
    ),
  delete: (event) =>
    groupAction(
      event,
      z.object({ actionId }),
      (input) => deleteGroup(db, input),
      { thenHome: true }
    ),
} satisfies Actions;
