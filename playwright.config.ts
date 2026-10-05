import { randomInt } from "node:crypto";

import { defineConfig } from "@playwright/test";

import {
  TEST_AUTH_SECRET,
  testDatabaseUrl,
} from "#lib/server/testing/environment.ts";

export default defineConfig({
  webServer: {
    command: "bun run build && bun run preview",
    port: 4173,
    // The tested app and fixtures must use the same disposable DB. Override
    // inherited provider settings so browser tests can never send real email.
    env: {
      DATABASE_URL: testDatabaseUrl(),
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      RESEND_API_KEY: "",
      VERCEL_ENV: "development",
    },
  },
  testMatch: "**/*.e2e.{ts,js}",
  use: {
    // Locally there's no proxy setting the client IP, so every request would
    // share one per-IP rate-limit bucket (10 codes per 10 minutes) across runs.
    // A random IP per run gives this run its own bucket.
    extraHTTPHeaders: {
      "x-forwarded-for": `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`,
    },
  },
});
