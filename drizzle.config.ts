import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { defineConfig } from "drizzle-kit";
import { z } from "zod";

import { assertPreviewIsolated } from "./src/lib/server/db/production-guard.ts";
import { withVerifiedTls } from "./src/lib/server/db/url.ts";

// drizzle-kit runs under Node and only auto-loads `.env`. Vite and Bun let
// `.env.local` (the Development URLs from `vercel env pull`) win, so do the
// same here; otherwise migrations could hit a different database than the app.
if (existsSync(".env.local")) {
  Object.assign(process.env, parseEnv(readFileSync(".env.local", "utf8")));
}

// Migrations need a real Postgres session, so they use Neon's direct
// (unpooled) connection instead of the app's pooled DATABASE_URL.
const unpooledUrl = z
  .url({
    protocol: /^postgres(ql)?$/,
    error: "DATABASE_URL_UNPOOLED is not set. Run `vercel env pull`.",
  })
  .parse(process.env.DATABASE_URL_UNPOOLED);
// Vercel runs `db:migrate` before every build, Preview builds included.
assertPreviewIsolated(process.env.VERCEL_ENV, unpooledUrl);

export default defineConfig({
  schema: "./src/lib/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: withVerifiedTls(unpooledUrl) },
  verbose: true,
  strict: true,
});
