import { describe, expect, it } from "vitest";

import {
  describeMovie,
  describePreferences,
  NO_PREFERENCES,
  preferencesFromQuery,
  preferencesToQuery,
} from "#lib/deck-fields.ts";
import { NO_BREAK_SPACE } from "#lib/format.ts";

// Preferences live only in the deck's URL, so the query is their storage
// format: it must round-trip, and a bad link must still open the deck.

const genres = new Map([
  [18, "Drama"],
  [35, "Comedy"],
]);

describe("preferences in the URL", () => {
  it("round-trips through the query, with genres sorted and deduplicated", () => {
    const query = new URLSearchParams(
      "maxRuntime=120&minYear=1990&maxYear=2009&genreIds=35&genreIds=18&genreIds=35&animation=exclude&ratings=R&ratings=PG-13&ratings=R"
    );
    const preferences = preferencesFromQuery(query);
    expect(preferences).toEqual({
      maxRuntime: 120,
      minYear: 1990,
      maxYear: 2009,
      genreIds: [18, 35],
      animation: "exclude",
      // In the order they're offered.
      ratings: ["PG-13", "R"],
    });
    expect(
      preferencesFromQuery(new URLSearchParams(preferencesToQuery(preferences)))
    ).toEqual(preferences);
  });

  it("reads an invalid query as no preferences", () => {
    for (const query of [
      "maxRuntime=abc",
      "minYear=2010&maxYear=1990",
      "genreIds=-1",
      "animation=sometimes",
      "ratings=X",
    ]) {
      expect(preferencesFromQuery(new URLSearchParams(query))).toEqual(
        NO_PREFERENCES
      );
    }
  });

  it("writes nothing for no preferences", () => {
    expect(preferencesToQuery(NO_PREFERENCES)).toBe("");
  });

  it("reads the empty Any choices as no preferences", () => {
    expect(
      preferencesFromQuery(new URLSearchParams("animation=&maxRuntime="))
    ).toEqual(NO_PREFERENCES);
  });
});

describe("describePreferences", () => {
  it("says Anything when nothing is set", () => {
    expect(describePreferences(NO_PREFERENCES, genres)).toBe("Anything");
  });

  it("lists only the parts that are set", () => {
    expect(
      describePreferences({ ...NO_PREFERENCES, genreIds: [35] }, genres)
    ).toBe("Comedy");
    expect(
      describePreferences(
        {
          maxRuntime: 120,
          minYear: 1990,
          maxYear: 2009,
          genreIds: [18, 35],
          animation: "exclude",
          ratings: ["PG-13", "NR"],
        },
        genres
      )
    ).toBe(
      "Drama, Comedy · Not animated · PG-13, Not rated · Up to 2 h · 1990–2009"
    );
    expect(
      describePreferences({ ...NO_PREFERENCES, animation: "only" }, genres)
    ).toBe("Only animated");
    expect(
      describePreferences({ ...NO_PREFERENCES, minYear: 2000 }, genres)
    ).toBe("2000 or later");
  });
});

describe("describeMovie", () => {
  const movie = {
    id: 1,
    title: "Arrival",
    year: 2016,
    runtime: 116,
    posterPath: null,
    genres: ["Drama", "Science Fiction", "Mystery", "Thriller"],
  };

  it("breaks lines only between parts, never inside the runtime", () => {
    // No-break spaces shown as "_".
    const breaks = describeMovie(movie).replaceAll(NO_BREAK_SPACE, "_");
    expect(breaks).toBe("2016_· 1_h_56_min_· Drama, Science Fiction, Mystery");
  });

  it("skips what's missing", () => {
    expect(
      describeMovie({ ...movie, year: null, runtime: null, genres: [] })
    ).toBe("");
  });
});
