import { DATABASE_URL, VERCEL_ENV } from "$app/env/private";
import { attachDatabasePool } from "@vercel/functions";

import { createDb } from "./client.ts";
import { assertPreviewIsolated } from "./production-guard.ts";

// The build's migration step checks this too; this also covers the requests.
assertPreviewIsolated(VERCEL_ENV, DATABASE_URL);

// Runs once per instance: Node caches modules, so every request on a warm
// Fluid compute instance shares this pool. Two connections is plenty because
// Neon's pooler (DATABASE_URL) multiplexes them onto real Postgres connections.
const { pool, db } = createDb(DATABASE_URL, 2);

// Closes idle connections before Vercel suspends the instance, so they don't leak.
attachDatabasePool(pool);

export { db };
