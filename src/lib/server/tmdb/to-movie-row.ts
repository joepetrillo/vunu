import type { NewMovie } from "#lib/server/db/schema.ts";

import type { TmdbMovieDetails } from "./schemas.ts";

// A US premiere (type 1) is usually a festival screening, not a public release.
const PUBLIC_RELEASE_TYPES = new Set([2, 3, 4, 5, 6]);
// Theatrical ratings are the canonical MPA ones; later releases often repeat
// them or leave them blank.
const CERTIFICATION_PREFERENCE = [3, 2, 4, 5, 6, 1];

export function toMovieRow(
  details: TmdbMovieDetails,
  syncedAt: Date
): { movie: NewMovie; genreIds: number[] } {
  const usReleases =
    details.release_dates.results.find((r) => r.iso_3166_1 === "US")
      ?.release_dates ?? [];

  const usReleaseDate =
    usReleases
      .filter((r) => PUBLIC_RELEASE_TYPES.has(r.type))
      // Date part only; the timestamps are midnight UTC placeholders.
      .map((r) => r.release_date.slice(0, 10))
      .sort()[0] ?? null;

  const usCertification =
    usReleases
      .filter((r) => r.certification.trim() !== "")
      .sort(
        (a, b) =>
          CERTIFICATION_PREFERENCE.indexOf(a.type) -
          CERTIFICATION_PREFERENCE.indexOf(b.type)
      )[0]
      ?.certification.trim() ?? null;

  return {
    movie: {
      id: details.id,
      title: details.title,
      // TMDB marks unknown values with "" or 0 rather than null.
      releaseDate: details.release_date === "" ? null : details.release_date,
      usReleaseDate,
      runtime: details.runtime === 0 ? null : details.runtime,
      usCertification,
      // With no votes, TMDB reports 0, which would read as a terrible rating.
      voteAverage: details.vote_count > 0 ? details.vote_average : null,
      voteCount: details.vote_count,
      posterPath: details.poster_path,
      imdbId: details.imdb_id === "" ? null : details.imdb_id,
      syncedAt,
    },
    // Junction rows are unique per movie/genre even if the provider repeats one.
    genreIds: [...new Set(details.genres.map((g) => g.id))],
  };
}
