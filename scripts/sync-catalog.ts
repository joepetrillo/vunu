/**
 * Loads the full TMDB catalog into our database and keeps it fresh (spec
 * section 2). Safe to re-run at any time; an interrupted run resumes.
 *
 * Production: only from the "Catalog sync" GitHub Actions workflow, every
 * 2 days and on demand. Locally: `bun run catalog:sync` fills the
 * Development database from .env.local (`vercel env pull`), which holds the
 * Development-only TMDB token.
 */
import { gte, lte, and } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "#lib/server/db/client.ts";
import {
  assertCatalogSyncTarget,
  isProductionDatabase,
} from "#lib/server/db/production-guard.ts";
import { movies } from "#lib/server/db/schema.ts";
import { VOTE_COUNT_FLOOR } from "#lib/server/group-deck.ts";
import { createTmdbClient } from "#lib/server/tmdb/client.ts";
import { syncCatalog, withCatalogLock } from "#lib/server/tmdb/sync-catalog.ts";

// Scripts run outside SvelteKit, so src/env.ts doesn't apply; validate here.
const env = z
  .object({
    DATABASE_URL_UNPOOLED: z.url({
      protocol: /^postgres(ql)?$/,
      error: "DATABASE_URL_UNPOOLED is not set. Run `vercel env pull`.",
    }),
    TMDB_READ_ACCESS_TOKEN: z.string().min(1),
    // Set to "true" by GitHub Actions; the only place Production is allowed.
    GITHUB_ACTIONS: z.string().optional(),
    // Never inside a Vercel deployment (the app doesn't call TMDB).
    VERCEL_ENV: z.literal("development").optional(),
  })
  .parse(process.env);

assertCatalogSyncTarget(env.DATABASE_URL_UNPOOLED, env.GITHUB_ACTIONS);

// Two connections, the project's pool limit: one holds the run's lock, the
// other does the work (the sync's writes run one at a time).
const { pool, db } = createDb(env.DATABASE_URL_UNPOOLED, 2);
const tmdb = createTmdbClient(env.TMDB_READ_ACCESS_TOKEN);
const log = (line: string) => {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
};

async function main(): Promise<void> {
  // Never print the hostname: Actions logs of a public repository are public.
  log(
    `Syncing the ${isProductionDatabase(env.DATABASE_URL_UNPOOLED) ? "Production" : "non-Production"} catalog.`
  );
  const report = await withCatalogLock(pool, () =>
    syncCatalog({ db, tmdb, log })
  );
  if (report === null) {
    log("Another sync is running on this database; nothing to do.");
    return;
  }

  // How many movies the deck could deal at a few vote floors (spec section 1,
  // Deck order), to judge VOTE_COUNT_FLOOR against the real catalog.
  const today = new Date().toISOString().slice(0, 10);
  const total = await db.$count(movies);
  const dealable = await Promise.all(
    [100, VOTE_COUNT_FLOOR, 500, 1000].map(async (floor) => {
      const count = await db.$count(
        movies,
        and(gte(movies.voteCount, floor), lte(movies.usReleaseDate, today))
      );
      return `${String(floor)}+ votes: ${String(count)}`;
    })
  );
  log(
    `Catalog: ${String(total)} movies. Released in the US with ${dealable.join(", ")}.`
  );
}

try {
  await main();
} finally {
  await pool.end();
}
