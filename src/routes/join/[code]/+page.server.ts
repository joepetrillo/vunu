import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";

import { inviteCodeSchema, nicknameSchema } from "#lib/group-fields.ts";
import { db } from "#lib/server/db/index.ts";
import {
  findInvite,
  readForm,
  refusal,
  refusalMessage,
} from "#lib/server/group-forms.ts";
import { joinGroup, lastNickname, previewInvite } from "#lib/server/groups.ts";
import { requireUser } from "#lib/server/require-user.ts";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const user = requireUser(locals);
  const code = inviteCodeSchema.safeParse(params.code);
  if (!code.success) {
    return { found: false, message: refusalMessage("invite_invalid") } as const;
  }
  // One address per invite ("/join/k7qm2x" becomes "/join/K7QM2X").
  if (code.data !== params.code) redirect(303, `/join/${code.data}`);

  const preview = await previewInvite(db, user.id, code.data);
  if (preview.status !== "found") {
    return { found: false, message: refusalMessage(preview.status) } as const;
  }
  if (preview.isMember) redirect(303, `/groups/${preview.id}`);
  return {
    found: true,
    group: { id: preview.id, name: preview.name },
    nickname: await lastNickname(db, user.id),
  } as const;
};

const joinSchema = z.object({
  actionId: z.uuid(),
  // From the preview above; the server checks the code still belongs to it.
  groupId: z.uuid(),
  nickname: nicknameSchema,
});

export const actions = {
  // A dead link shows the code form, so the person can try another code.
  find: findInvite,
  join: async ({ request, locals, params }) => {
    const user = requireUser(locals);
    const code = inviteCodeSchema.safeParse(params.code);
    if (!code.success) {
      return fail(404, { message: refusalMessage("invite_invalid") });
    }
    const form = await readForm(request, joinSchema);
    if (!form.ok) return form.failure;

    const outcome = await joinGroup(db, {
      userId: user.id,
      inviteCode: code.data,
      ...form.data,
    });
    const failed = refusal(outcome);
    if (failed !== null) return failed;
    redirect(303, `/groups/${form.data.groupId}`);
  },
} satisfies Actions;
