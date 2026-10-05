import { fail } from "@sveltejs/kit";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-orm/zod";
import { DatabaseError } from "pg";
import { z } from "zod";

import { db } from "#lib/server/db/index.ts";
import { genres, movies, seenMovies } from "#lib/server/db/schema.ts";
import { MAX_PAGE, searchMovies } from "#lib/server/movie-search.ts";
import { requireUser } from "#lib/server/require-user.ts";
import { addToSeenList, removeFromSeenList } from "#lib/server/seen-list.ts";

import type { Actions, PageServerLoad } from "./$types";

// Schemas built from our tables, so an ID's bounds match its column (a number
// too big for Postgres' `integer` fails validation, not the query). Form and
// URL values are always strings, hence the coercion.
const { createSelectSchema } = createSchemaFactory({
  coerce: { number: true },
});

// Newest first. The 1900s are far enough back for well-known movies.
const latestDecade = Math.floor(new Date().getFullYear() / 10) * 10;
const decades = Array.from(
  { length: (latestDecade - 1900) / 10 + 1 },
  (_, i) => latestDecade - i * 10
);

// The URL's search params. A malformed value (say, a hand-edited link) falls
// back to its default instead of failing the whole page.
const searchSchema = z.object({
  scope: z.enum(["mine", "all"]).catch("mine"),
  title: z.string().trim().max(100).catch(""),
  genre: createSelectSchema(genres)
    .shape.id.positive()
    .optional()
    .catch(undefined),
  decade: z.coerce
    .number()
    .int()
    .multipleOf(10)
    .min(1900)
    .max(latestDecade)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).catch(1),
});

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals);
  const search = searchSchema.parse(Object.fromEntries(url.searchParams));

  const [results, genreOptions, seenCount] = await Promise.all([
    searchMovies(db, user.id, search),
    db.query.genres.findMany({ orderBy: { name: "asc" } }),
    db.$count(seenMovies, eq(seenMovies.userId, user.id)),
  ]);

  return { search, ...results, genres: genreOptions, decades, seenCount };
};

// What a Seen it / Remove button sends. The browser generates the action ID
// (see SeenButton.svelte), so the forms need JavaScript.
const seenListFormSchema = z.object({
  actionId: z.uuid(),
  movieId: createSelectSchema(movies).shape.id.positive(),
});

async function changeSeenList(
  request: Request,
  locals: App.Locals,
  change: typeof addToSeenList
) {
  const user = requireUser(locals);
  // Malformed multipart bodies can fail before Zod sees any fields.
  const fields = await request.formData().catch((error: unknown) => {
    if (error instanceof TypeError) return null;
    throw error;
  });
  const form = seenListFormSchema.safeParse(
    fields === null ? null : Object.fromEntries(fields)
  );
  if (!form.success) {
    return fail(400, {
      message: "Something went wrong. Reload the page and try again.",
    });
  }

  try {
    const outcome = await change(db, { userId: user.id, ...form.data });
    // Only a bug or a tampered request reuses an action ID for something else.
    if (outcome === "conflict") {
      return fail(409, {
        message: "Something went wrong. Reload the page and try again.",
      });
    }
    // "applied" and "duplicate" both mean the change is saved; a duplicate was
    // a retry of a request that already succeeded.
  } catch (error) {
    // The action's FK is checked before applying a change. Treat a movie that
    // isn't in the catalog as an expected failure; propagate other DB errors.
    if (
      error instanceof DrizzleQueryError &&
      error.cause instanceof DatabaseError &&
      error.cause.code === "23503" &&
      error.cause.constraint === "actions_movie_id_movies_id_fkey"
    ) {
      return fail(404, {
        message: "That movie is no longer in the catalog. Reload the page.",
      });
    }
    throw error;
  }
}

export const actions = {
  add: ({ request, locals }) => changeSeenList(request, locals, addToSeenList),
  remove: ({ request, locals }) =>
    changeSeenList(request, locals, removeFromSeenList),
} satisfies Actions;
