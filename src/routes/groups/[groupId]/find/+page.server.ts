import { error } from "@sveltejs/kit";
import { z } from "zod";

import { preferencesFromQuery } from "#lib/deck-fields.ts";
import { db } from "#lib/server/db/index.ts";
import {
  deckRefusal,
  excludeSchema,
  movieIdSchema,
} from "#lib/server/deck-forms.ts";
import { readForm } from "#lib/server/forms.ts";
import {
  answerMovie,
  canUndo,
  countMatches,
  describeDeckPreferences,
  getCard,
  listPreferenceGenres,
  readDeckState,
  undoLastAnswer,
} from "#lib/server/group-deck.ts";
import { requireUser } from "#lib/server/require-user.ts";

import type { Actions, PageServerLoad } from "./$types";

// The group deck. Tonight's preferences live in this page's URL query
// (?maxRuntime=120&genreIds=35), so they start fresh every time you come
// from the group page (through "In the mood for") and nothing about them is
// stored.
export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const user = requireUser(locals);
  // The layout's membership check first (see ../+layout.server.ts).
  const { group } = await parent();

  const preferences = preferencesFromQuery(url.searchParams);
  const [mood, genres, deck] = await Promise.all([
    describeDeckPreferences(db, preferences),
    // For changing preferences from the deck.
    listPreferenceGenres(db),
    readDeckState(db, {
      groupId: group.id,
      userId: user.id,
      preferences,
      exclude: [],
    }),
  ]);
  return { preferences, mood, genres, deck };
};

const answerSchema = z.object({
  actionId: z.uuid(),
  movieId: movieIdSchema,
  answer: z.enum(["seen", "not_seen"]),
  exclude: excludeSchema,
});

function groupIdFrom(params: { groupId: string }): string {
  const id = z.uuid().safeParse(params.groupId);
  if (!id.success) error(404, "Group not found.");
  return id.data;
}

export const actions = {
  // Answers come from the deck's save queue (deck.svelte.ts), one at a time.
  // Each reply carries fresh cards, so the queue refills as you answer. The
  // deck posts with its preferences still in the URL, so the reply deals
  // the same way the page does.
  answer: async ({ request, locals, params, url }) => {
    const user = requireUser(locals);
    const groupId = groupIdFrom(params);
    const form = await readForm(request, answerSchema);
    if (!form.ok) return form.failure;

    const { exclude, ...change } = form.data;
    const failed = deckRefusal(
      await answerMovie(db, { ...change, userId: user.id, groupId })
    );
    if (failed !== null) return failed;
    return readDeckState(db, {
      groupId,
      userId: user.id,
      preferences: preferencesFromQuery(url.searchParams),
      exclude,
    });
  },

  undo: async ({ request, locals, params }) => {
    const user = requireUser(locals);
    const groupId = groupIdFrom(params);
    const form = await readForm(request, z.object({ actionId: z.uuid() }));
    if (!form.ok) return form.failure;

    const { outcome, movieId } = await undoLastAnswer(db, {
      actionId: form.data.actionId,
      userId: user.id,
      groupId,
    });
    const failed = deckRefusal(outcome);
    if (failed !== null) return failed;
    // The undone movie goes back on screen in front of the current card; the
    // queue behind it stays, so no new cards are dealt here.
    const [card, matchCount, undoable] = await Promise.all([
      movieId === null ? null : getCard(db, movieId),
      countMatches(db, groupId),
      canUndo(db, user.id, groupId),
    ]);
    return { card, matchCount, canUndo: undoable };
  },
} satisfies Actions;
