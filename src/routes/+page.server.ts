import { db } from "#lib/server/db/index.ts";
import { listGroups } from "#lib/server/groups.ts";
import { requireUser } from "#lib/server/require-user.ts";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  return { groups: await listGroups(db, user.id) };
};
