import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "#lib/server/db/client.ts";
import { testDatabaseUrl } from "#lib/server/testing/environment.ts";

// Bypass drizzle.config.ts's Development URL loading. This command can only
// select the explicitly supplied disposable test database.
const { pool, db } = createDb(testDatabaseUrl(), 1);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Test database migrations applied.");
} finally {
  await pool.end();
}
