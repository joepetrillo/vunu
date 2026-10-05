import { z } from "zod";

// Only the fields we use. Zod drops unknown keys, so TMDB adding fields never
// breaks parsing; a missing or retyped field fails loudly instead of storing junk.

export const genreSchema = z.object({
  id: z.int32().positive(),
  name: z.string().trim().min(1),
});

export const genreListSchema = z.object({
  genres: z.array(genreSchema),
});

export const discoverPageSchema = z.object({
  page: z.int32().min(1).max(500),
  total_pages: z.int32().nonnegative(),
  results: z.array(z.object({ id: z.int32().positive() })),
});

const releaseDateSchema = z.object({
  certification: z.string(),
  // ISO timestamp, e.g. "2010-07-16T00:00:00.000Z".
  release_date: z.iso.datetime({ offset: true }),
  // 1 premiere, 2 limited theatrical, 3 theatrical, 4 digital, 5 physical, 6 TV.
  type: z.number().int().min(1).max(6),
});

export const movieDetailsSchema = z.object({
  id: z.int32().positive(),
  title: z.string().trim().min(1),
  // TMDB uses "" (not null) when a date is unknown.
  release_date: z.union([z.literal(""), z.iso.date()]),
  // TMDB uses 0 or null when the runtime is unknown.
  runtime: z.int32().nonnegative().nullable(),
  genres: z.array(genreSchema),
  vote_average: z.number().min(0).max(10),
  vote_count: z.int32().nonnegative(),
  // TMDB returns one filename beginning with '/', not a URL or srcset list.
  poster_path: z
    .string()
    .regex(/^\/[\w-]+\.[a-zA-Z0-9]+$/)
    .nullable(),
  imdb_id: z.union([z.literal(""), z.string().regex(/^tt\d+$/)]).nullable(),
  // Present because we request it with `append_to_response=release_dates`.
  release_dates: z.object({
    results: z.array(
      z.object({
        iso_3166_1: z.string().regex(/^[A-Z]{2}$/),
        release_dates: z.array(releaseDateSchema),
      })
    ),
  }),
});

export type TmdbGenre = z.infer<typeof genreSchema>;
export type TmdbMovieDetails = z.infer<typeof movieDetailsSchema>;
