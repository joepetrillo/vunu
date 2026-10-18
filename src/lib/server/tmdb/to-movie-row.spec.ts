import { describe, expect, it } from "vitest";

import type { TmdbMovieDetails } from "./schemas.ts";
import { toMovieRow } from "./to-movie-row.ts";

const syncedAt = new Date("2026-09-30T12:00:00Z");

function details(overrides: Partial<TmdbMovieDetails> = {}): TmdbMovieDetails {
  return {
    id: 27205,
    title: "Inception",
    release_date: "2010-07-15",
    runtime: 148,
    genres: [
      { id: 28, name: "Action" },
      { id: 878, name: "Science Fiction" },
    ],
    vote_average: 8.4,
    vote_count: 38000,
    poster_path: "/poster.jpg",
    imdb_id: "tt1375666",
    release_dates: { results: [] },
    ...overrides,
  };
}

function usReleases(
  releases: { type: number; certification?: string; date: string }[]
): TmdbMovieDetails["release_dates"] {
  return {
    results: [
      {
        iso_3166_1: "US",
        release_dates: releases.map((r) => ({
          type: r.type,
          certification: r.certification ?? "",
          release_date: `${r.date}T00:00:00.000Z`,
        })),
      },
    ],
  };
}

describe("toMovieRow", () => {
  it("maps a complete movie", () => {
    const { movie, genreIds } = toMovieRow(
      details({
        release_dates: usReleases([
          { type: 3, certification: "PG-13", date: "2010-07-16" },
        ]),
      }),
      syncedAt
    );

    expect(movie).toEqual({
      id: 27205,
      title: "Inception",
      releaseDate: "2010-07-15",
      usReleaseDate: "2010-07-16",
      runtime: 148,
      usCertification: "PG-13",
      voteAverage: 8.4,
      voteCount: 38000,
      posterPath: "/poster.jpg",
      imdbId: "tt1375666",
      syncedAt,
      detailsSyncedAt: syncedAt,
    });
    expect(genreIds).toEqual([28, 878]);
  });

  it("uses the earliest public US release, ignoring premieres", () => {
    const { movie } = toMovieRow(
      details({
        release_dates: usReleases([
          { type: 1, date: "2010-07-08" },
          { type: 4, date: "2010-12-07" },
          { type: 3, date: "2010-07-16" },
        ]),
      }),
      syncedAt
    );
    expect(movie.usReleaseDate).toBe("2010-07-16");
  });

  it("has no US release date when the only US release is a premiere", () => {
    const { movie } = toMovieRow(
      details({ release_dates: usReleases([{ type: 1, date: "2010-07-08" }]) }),
      syncedAt
    );
    expect(movie.usReleaseDate).toBeNull();
  });

  it("ignores other countries' releases and ratings", () => {
    const { movie } = toMovieRow(
      details({
        release_dates: {
          results: [
            {
              iso_3166_1: "GB",
              release_dates: [
                {
                  type: 3,
                  certification: "12A",
                  release_date: "2010-07-16T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      }),
      syncedAt
    );
    expect(movie.usReleaseDate).toBeNull();
    expect(movie.usCertification).toBeNull();
  });

  it("prefers the theatrical rating and skips blank ones", () => {
    const { movie } = toMovieRow(
      details({
        release_dates: usReleases([
          { type: 4, certification: "NR", date: "2010-12-07" },
          { type: 3, certification: " ", date: "2010-07-16" },
          { type: 2, certification: "R", date: "2010-07-10" },
        ]),
      }),
      syncedAt
    );
    expect(movie.usCertification).toBe("R");
  });

  it("stores TMDB's placeholders for unknown values as null", () => {
    const { movie } = toMovieRow(
      details({
        release_date: "",
        runtime: 0,
        imdb_id: "",
        vote_average: 0,
        vote_count: 0,
        poster_path: null,
      }),
      syncedAt
    );
    expect(movie).toMatchObject({
      releaseDate: null,
      runtime: null,
      imdbId: null,
      voteAverage: null,
      voteCount: 0,
      posterPath: null,
    });
  });
});
