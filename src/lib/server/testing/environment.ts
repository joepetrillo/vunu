import { z } from "zod";

// Only used by a browser server connected to the explicitly selected test DB.
export const TEST_AUTH_SECRET =
  "vunu-disposable-test-secret-at-least-32-characters";

/**
 * Selects a disposable database from the shell only. Never falls back to app
 * credentials, and never reads `.env.local` (Vercel overwrites it on each pull).
 */
export function testDatabaseUrl(): string {
  return z
    .url({
      protocol: /^postgres(ql)?$/,
      error:
        "Set TEST_DATABASE_URL to an explicitly disposable PostgreSQL database before running tests.",
    })
    .parse(process.env.TEST_DATABASE_URL);
}
