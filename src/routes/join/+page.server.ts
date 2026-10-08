import { redirect } from "@sveltejs/kit";

import { inviteCodeSchema } from "#lib/group-fields.ts";

import type { PageServerLoad } from "./$types";

// "Join with a code" is a plain GET form (?code=…), so it works before any
// JavaScript loads. A code that could be valid goes to its invite page,
// which does the (rate-limited) lookup; anything else is answered here.
export const load: PageServerLoad = ({ url }) => {
  const typed = url.searchParams.get("code");
  if (typed === null) return { typed: "", invalid: false };
  const code = inviteCodeSchema.safeParse(typed);
  if (code.success) redirect(303, `/join/${code.data}`);
  return { typed, invalid: true };
};
