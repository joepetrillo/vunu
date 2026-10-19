import { preferencesFromQuery } from "#lib/deck-fields.ts";
import { db } from "#lib/server/db/index.ts";
import { listPreferenceGenres } from "#lib/server/group-deck.ts";

import type { PageServerLoad } from "./$types";

// "In the mood for", the first step of Find a movie: tonight's preferences,
// picked here and carried to the deck in its URL. Nothing is saved.
export const load: PageServerLoad = async ({ parent, url }) => {
  // The layout's membership check first (see ../../+layout.server.ts).
  await parent();
  return {
    preferences: preferencesFromQuery(url.searchParams),
    genres: await listPreferenceGenres(db),
  };
};
