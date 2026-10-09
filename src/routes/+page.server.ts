import { db } from "#lib/server/db/index.ts";
import { findInvite } from "#lib/server/group-forms.ts";
import { listGroups } from "#lib/server/groups.ts";
import { requireUser } from "#lib/server/require-user.ts";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  return { groups: await listGroups(db, user.id) };
};

export const actions = { find: findInvite } satisfies Actions;
