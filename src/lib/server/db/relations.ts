import { defineRelations } from "drizzle-orm";

import * as schema from "./schema.ts";

// Relations only shape relational queries (`db.query.*`); they don't create
// database constraints. `through` hides the junction table, so a movie's
// `genres` are genre rows, not movie_genres rows.
export const relations = defineRelations(schema, (r) => ({
  movies: {
    genres: r.many.genres({
      from: r.movies.id.through(r.movieGenres.movieId),
      to: r.genres.id.through(r.movieGenres.genreId),
    }),
  },
  genres: {
    movies: r.many.movies(),
  },
  groups: {
    members: r.many.groupMembers(),
  },
  groupMembers: {
    group: r.one.groups({
      from: r.groupMembers.groupId,
      to: r.groups.id,
      optional: false,
    }),
  },
  // Better Auth's relations (from its generator). Its adapter uses them for
  // joins; we rarely query them directly.
  users: {
    sessions: r.many.sessions(),
    accounts: r.many.accounts(),
  },
  sessions: {
    user: r.one.users({ from: r.sessions.userId, to: r.users.id }),
  },
  accounts: {
    user: r.one.users({ from: r.accounts.userId, to: r.users.id }),
  },
}));
