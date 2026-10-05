import { describe, expect, it } from "vitest";

import { movieDetailsSchema } from "./schemas.ts";

const valid = {
  id: 27205,
  title: "Inception",
  release_date: "2010-07-15",
  runtime: 148,
  genres: [{ id: 28, name: "Action" }],
  vote_average: 8.4,
  vote_count: 38000,
  poster_path: "/poster.jpg",
  imdb_id: "tt1375666",
  release_dates: { results: [] },
};

describe("TMDB's validated catalog boundary", () => {
  it("accepts normal fields, unknown-field additions, and documented placeholders", () => {
    expect(
      movieDetailsSchema.safeParse({ ...valid, extra: "ignored" }).success
    ).toBe(true);
    expect(
      movieDetailsSchema.safeParse({
        ...valid,
        release_date: "",
        runtime: 0,
        poster_path: null,
        imdb_id: "",
        vote_count: 0,
      }).success
    ).toBe(true);
  });

  it.each([
    { id: -1 },
    { id: 2147483648 },
    { title: " " },
    { release_date: "2026-02-30" },
    { release_date: "not-a-date" },
    { runtime: -1 },
    { vote_average: 11 },
    { vote_count: -1 },
    { poster_path: "https://evil.example/image.jpg" },
    { poster_path: "/poster.jpg, https://evil.example/image.jpg 2x" },
    { poster_path: "/../../image.jpg" },
    { imdb_id: "https://evil.example" },
  ])("rejects malformed domain fields (%j)", (change) => {
    expect(movieDetailsSchema.safeParse({ ...valid, ...change }).success).toBe(
      false
    );
  });

  it("validates dates and release types before the SQL mapping/sort", () => {
    const releases = (date: string, type: number) => ({
      results: [
        {
          iso_3166_1: "US",
          release_dates: [{ certification: "PG", release_date: date, type }],
        },
      ],
    });
    expect(
      movieDetailsSchema.safeParse({
        ...valid,
        release_dates: releases("2010-07-16T00:00:00.000Z", 3),
      }).success
    ).toBe(true);
    expect(
      movieDetailsSchema.safeParse({
        ...valid,
        release_dates: releases("bad", 3),
      }).success
    ).toBe(false);
    expect(
      movieDetailsSchema.safeParse({
        ...valid,
        release_dates: releases("2010-07-16T00:00:00.000Z", 99),
      }).success
    ).toBe(false);
  });
});
