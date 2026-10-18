import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTmdbClient } from "./client.ts";

const fetchMock = vi.fn<typeof fetch>();
const tmdb = createTmdbClient("mock-token-never-sent");
const genres = { genres: [{ id: 28, name: "Action" }] };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TMDB HTTP client", () => {
  it("sets a request timeout and validates a successful response", async () => {
    fetchMock.mockResolvedValue(Response.json(genres));
    expect(await tmdb.genres()).toEqual(genres);
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toEqual({
      Authorization: "Bearer mock-token-never-sent",
      Accept: "application/json",
    });
  });

  it("doesn't retry invalid data or a non-transient status", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ genres: [{ id: -1, name: "Action" }] })
    );
    await expect(tmdb.genres()).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(tmdb.genres()).rejects.toThrow(
      "TMDB /genre/movie/list returned 401"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient errors only four times", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 503 }))
    );
    const pending = expect(tmdb.genres()).rejects.toThrow(/503/);
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["999999999999999", "Fri, 02 Oct 2026 12:00:00 GMT"])(
    "bounds a provider-controlled Retry-After (%s)",
    async (retryAfter) => {
      vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
      fetchMock
        .mockResolvedValueOnce(
          new Response(null, {
            status: 429,
            headers: { "retry-after": retryAfter },
          })
        )
        .mockResolvedValueOnce(Response.json(genres));
      const pending = tmdb.genres();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual(genres);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it("propagates transport/timeout failures instead of concealing them", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("Request timed out", "TimeoutError")
    );
    await expect(tmdb.genres()).rejects.toThrow("Request timed out");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't persist another movie returned for a requested ID", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        id: 2,
        title: "Another movie",
        release_date: "",
        runtime: null,
        genres: [],
        vote_average: 0,
        vote_count: 0,
        poster_path: null,
        imdb_id: null,
        release_dates: { results: [] },
      })
    );
    await expect(tmdb.movieDetails(1)).rejects.toThrow(
      "TMDB returned a different movie than requested."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for a movie TMDB doesn't have, without retrying", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await tmdb.movieDetails(1)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Lists always exist, so a 404 there is an error.
    await expect(tmdb.genres()).rejects.toThrow(
      "TMDB /genre/movie/list returned 404"
    );
  });

  it("asks discover for one date range above a vote count", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ page: 2, total_pages: 3, total_results: 41, results: [] })
    );
    await tmdb.discover({
      minVotes: 50,
      from: "1994-01-01",
      to: "1994-12-31",
      page: 2,
    });
    const requested = fetchMock.mock.calls[0]?.[0];
    if (typeof requested !== "string") throw new Error("Expected a URL string");
    const url = new URL(requested);
    expect(url.pathname).toBe("/3/discover/movie");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      "vote_count.gte": "50",
      "primary_release_date.gte": "1994-01-01",
      "primary_release_date.lte": "1994-12-31",
      include_adult: "false",
      page: "2",
    });
  });
});
