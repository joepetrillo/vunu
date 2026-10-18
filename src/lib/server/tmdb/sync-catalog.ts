import { and, asc, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { Pool } from "pg";

import type { Db } from "#lib/server/db/client.ts";
import { movies } from "#lib/server/db/schema.ts";

import type { DiscoverQuery, TmdbClient } from "./client.ts";
import { saveCatalog, saveDiscovered } from "./save-catalog.ts";
import type { TmdbDiscoveredMovie, TmdbMovieDetails } from "./schemas.ts";

// The catalog keeps every movie with at least this many TMDB votes. The deck
// deals only those above VOTE_COUNT_FLOOR (group-deck.ts), so that floor can
// move without a resync, and seen-list search finds less-known movies too.
export const CATALOG_MIN_VOTES = 50;

// The workflow runs every 2 days. Refreshing a seventh of the catalog's
// details per run keeps each movie's details about 2 weeks old at most.
export const REFRESH_SHARE = 7;
// Movies detailed within the last day are skipped, so re-running after an
// interruption doesn't refresh another seventh.
const REFRESH_MIN_AGE_MS = 24 * 60 * 60 * 1000;

// TMDB serves at most 500 pages (20 movies each) per discover query.
const MAX_PAGES = 500;
// TMDB's earliest films are from the 1870s; a little future covers announced
// movies that already have votes (the deck skips unreleased ones).
const FIRST_DAY = "1870-01-01";
const FUTURE_YEARS = 2;
// Parallel TMDB requests; TMDB allows roughly 50 per second, and the client
// waits and retries when it's told to slow down.
const CONCURRENCY = 8;
// Details saved per transaction: an interruption loses at most one batch,
// and live requests never wait on a long lock.
const DETAILS_BATCH = 100;
const DISCOVER_BATCH = 1000;
// One movie TMDB describes in a way we reject shouldn't stop the rest of the
// catalog, but this many means something systemic (bad token, outage).
const MAX_FAILURES = 20;

export interface SyncReport {
  discovered: number;
  newMovies: number;
  detailed: number;
  /** Movies TMDB no longer has; their rows stay (people may have seen them). */
  gone: number;
  failed: number;
}

/**
 * Loads the full catalog the first time and keeps it fresh after that:
 * 1. Discover every movie with CATALOG_MIN_VOTES votes, saving new movies and
 *    every movie's current votes.
 * 2. Fetch details for movies that have none yet, plus the stalest
 *    1/REFRESH_SHARE of the catalog.
 * Progress is the data itself (`details_synced_at`), so a run that dies
 * part-way resumes where it stopped: the next run's to-do query returns
 * what's left.
 */
export async function syncCatalog(options: {
  db: Db;
  tmdb: Pick<TmdbClient, "genres" | "discover" | "movieDetails">;
  now?: Date;
  log?: (line: string) => void;
}): Promise<SyncReport> {
  const { db, tmdb, now = new Date(), log = () => undefined } = options;
  const report: SyncReport = {
    discovered: 0,
    newMovies: 0,
    detailed: 0,
    gone: 0,
    failed: 0,
  };

  // 1. Discovery.
  const found = await discoverAll(tmdb, now, log);
  // Without this check, an outage that returns empty pages would look like a
  // successful run.
  if (found.length === 0)
    throw new Error("TMDB discovered no movies; catalog unchanged.");
  report.discovered = found.length;
  for (const batch of chunks(found, DISCOVER_BATCH)) {
    const { inserted } = await saveDiscovered(db, {
      movies: batch,
      syncedAt: now,
    });
    report.newMovies += inserted;
  }
  log(
    `Discovered ${String(report.discovered)} movies (${String(report.newMovies)} new).`
  );

  // 2. Details.
  const due = await detailsDue(db, now);
  log(`Fetching details for ${String(due.length)} movies.`);
  const { genres } = await tmdb.genres();
  for (const [index, batch] of chunks(due, DETAILS_BATCH).entries()) {
    const detailed: TmdbMovieDetails[] = [];
    const gone: number[] = [];
    await mapWithConcurrency(batch, CONCURRENCY, async (id) => {
      try {
        const details = await tmdb.movieDetails(id);
        if (details === null) gone.push(id);
        else detailed.push(details);
      } catch (error) {
        report.failed++;
        log(`Movie ${String(id)} failed: ${messageOf(error)}`);
        if (report.failed >= MAX_FAILURES)
          throw new Error(
            `Stopped after ${String(report.failed)} failed movies.`,
            { cause: error }
          );
      }
    });
    await saveCatalog(db, { genres, movies: detailed, syncedAt: now });
    // Marked as checked, so a movie TMDB removed isn't requested every run.
    // Its row stays: it's still a movie someone may have seen.
    if (gone.length > 0) {
      await db
        .update(movies)
        .set({ detailsSyncedAt: now })
        .where(inArray(movies.id, gone));
    }
    report.detailed += detailed.length;
    report.gone += gone.length;
    if ((index + 1) % 10 === 0)
      log(
        `Details: ${String(report.detailed)} of ${String(due.length)} saved.`
      );
  }

  log(
    `Details: ${String(report.detailed)} saved, ${String(report.gone)} gone from TMDB, ${String(report.failed)} failed.`
  );

  // Failed movies keep their old details (or none, so they aren't dealt) and
  // come first next run. Failing the run makes the alert fire.
  if (report.failed > 0)
    throw new Error(
      `Details failed for ${String(report.failed)} ${report.failed === 1 ? "movie" : "movies"}; everything else was saved.`
    );
  return report;
}

/** Every movie TMDB lists with enough votes, each once. */
async function discoverAll(
  tmdb: Pick<TmdbClient, "discover">,
  now: Date,
  log: (line: string) => void
): Promise<TmdbDiscoveredMovie[]> {
  const lastDay = `${String(now.getUTCFullYear() + FUTURE_YEARS)}-12-31`;
  const ranges = await splitRanges(tmdb, FIRST_DAY, lastDay);
  log(`Discovery split into ${String(ranges.length)} date ranges.`);

  // A movie whose date changes mid-run can show up in two ranges.
  const byId = new Map<number, TmdbDiscoveredMovie>();
  for (const range of ranges)
    for (const movie of range.firstPage) byId.set(movie.id, movie);
  const pages = ranges.flatMap((range) =>
    Array.from({ length: range.pages - 1 }, (_, i) => ({
      ...range.query,
      page: i + 2,
    }))
  );
  await mapWithConcurrency(pages, CONCURRENCY, async (query) => {
    const { results } = await tmdb.discover(query);
    for (const movie of results) byId.set(movie.id, movie);
  });
  return [...byId.values()];
}

interface Range {
  query: DiscoverQuery;
  pages: number;
  firstPage: TmdbDiscoveredMovie[];
}

/**
 * Splits [from, to] in half until each range fits in TMDB's 500 pages. The
 * first page of each range is kept: it's the request that measured it.
 */
async function splitRanges(
  tmdb: Pick<TmdbClient, "discover">,
  from: string,
  to: string
): Promise<Range[]> {
  const query = { minVotes: CATALOG_MIN_VOTES, from, to, page: 1 };
  const page = await tmdb.discover(query);
  if (page.total_pages <= MAX_PAGES)
    return [
      { query, pages: Math.max(page.total_pages, 1), firstPage: page.results },
    ];
  if (from === to)
    throw new Error(
      `More than ${String(MAX_PAGES)} pages of movies on ${from}.`
    );
  const middle = addDays(from, Math.floor(daysBetween(from, to) / 2));
  return [
    ...(await splitRanges(tmdb, from, middle)),
    ...(await splitRanges(tmdb, addDays(middle, 1), to)),
  ];
}

/** Movies without details, then the stalest share of the rest. */
async function detailsDue(db: Db, now: Date): Promise<number[]> {
  const missing = await db
    .select({ id: movies.id })
    .from(movies)
    .where(isNull(movies.detailsSyncedAt))
    .orderBy(asc(movies.id));
  const total = await db.$count(movies);
  const stale = await db
    .select({ id: movies.id })
    .from(movies)
    .where(
      and(
        isNotNull(movies.detailsSyncedAt),
        lt(movies.detailsSyncedAt, new Date(now.getTime() - REFRESH_MIN_AGE_MS))
      )
    )
    .orderBy(asc(movies.detailsSyncedAt), asc(movies.id))
    .limit(Math.ceil(total / REFRESH_SHARE));
  return [...missing, ...stale].map((row) => row.id);
}

// The sync holds this Postgres advisory lock (a named lock with no table)
// for its whole run. Any number: it only has to match between runs.
const LOCK_KEY = 9_090_901;

/**
 * Runs `fn` while holding the catalog sync lock, or returns null at once if
 * another sync holds it. The lock lives on one dedicated connection and is
 * released when the run ends, or by Postgres if the process dies. It needs
 * a direct connection: Neon's pooler hands sessions around, which would
 * lose a session-level lock.
 */
export async function withCatalogLock<T>(
  pool: Pool,
  fn: () => Promise<T>
): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [LOCK_KEY]
    );
    if (rows[0]?.locked !== true) return null;
    try {
      return await fn();
    } finally {
      // If the connection itself failed, Postgres already dropped the lock;
      // don't let that hide the run's own error.
      await client
        .query("SELECT pg_advisory_unlock($1)", [LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight. After a
 * failure the other workers stop taking new items, so nothing keeps calling
 * TMDB behind a run that has already failed.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        // `index` is always in range here, but noUncheckedIndexedAccess can't know that.
        await fn(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}
