# Vunu

Finds movies nobody in a group has seen. The current application has email-code sign-in, a movie catalog, and a personal seen list with search, filters, and pagination. Groups and watch sessions are later stages in the [product spec](docs/PROJECT_SPEC.md); stage 4 still needs its live-site check.

Live domain: [www.vunu.app](https://www.vunu.app). `vunu.app` redirects there. Repository: [joepetrillo/vunu](https://github.com/joepetrillo/vunu).

SvelteKit 3.0.0 stable, Svelte 5, TypeScript, Drizzle 1.0.0-rc.4, Neon Postgres through `pg`, Better Auth, Resend, and Vercel's Node adapter 7.0.0. The audit fixes, stable framework upgrade, and Vunu rebrand are implemented. The [audit](docs/AUDIT.md) records historical versions, source references, verification, and rollout notes; `bun.lock` records current resolved versions. [AGENTS.md](AGENTS.md) holds contributor conventions.

The remaining release check is [hosted verification](docs/PROJECT_SPEC.md#current-state): real sign-in email delivery, sign-in/sign-out, and seen-list persistence on `www.vunu.app`. Domain verification and sender configuration are complete. The first encrypted-OTP deployment requires fresh sign-in codes; codes issued by the preceding plaintext deployment are incompatible.

## Development setup

Requires **Node 24.x**, [Bun](https://bun.sh), and the Vercel CLI for the existing project's Development environment. Use the committed lockfile. The audit used Node 24.19.0 and Bun 1.4.2; Bun is not pinned yet.

```sh
bun install --frozen-lockfile
vercel link
vercel env pull # Development values -> .env.local
# Check the selected Development database before applying migrations.
bun run db:migrate
bun run dev
```

Vercel is the source of Development settings. Do not hand-edit `.env.local` or create competing env files. `drizzle.config.ts` deliberately loads `.env.local` before selecting `DATABASE_URL_UNPOOLED`. Its migration command **writes to that database**; an exported URL does not override this file. Do not pull Production settings for local work.

The dev server uses `http://localhost:5173`; preview uses `http://localhost:4173`. Both ports are strict because Better Auth trusts explicit hosts. Hosted sign-in trusts `vunu.app` and `www.vunu.app`; emails come from `Vunu <hello@vunu.app>` using the verified Resend domain. Local sign-in prints a code to the terminal when no Resend key is set.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Application's Neon pooled PostgreSQL URL |
| `DATABASE_URL_UNPOOLED` | Development/deploy migrations' direct PostgreSQL URL |
| `BETTER_AUTH_SECRET` | At least 32 characters; signs sessions and encrypts OTPs; distinct per environment |
| `RESEND_API_KEY` | Required on hosted Preview and Production; optional locally |
| `TMDB_READ_ACCESS_TOKEN` | Development-only TMDB token, used by `db:seed`, never by user requests |
| `VERCEL_ENV` | Vercel-provided `development`, `preview`, or `production`; normally unset outside Vercel |
| `TEST_DATABASE_URL` | Explicitly selected **disposable** PostgreSQL database; required for database and browser tests |

[.env.example](.env.example) lists names without credentials. Preview is not provisioned yet: it needs its own database, auth secret, email key, and an explicitly trusted host before sign-in will work. Never trust `*.vercel.app`.

## Safe test setup

Tests refuse to fall back to `DATABASE_URL`. Select a disposable PostgreSQL 18 database explicitly. For example, start this container in a separate terminal (the published port is local only):

```sh
docker run --rm --name vunu-test-db \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=vunu_test \
  -p 127.0.0.1:55432:5432 postgres:18
```

Once it accepts connections, run from the repository root:

```sh
export TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55432/vunu_test
bun run db:migrate:test
bunx playwright install --with-deps chromium
bun run verify
bun run test:e2e
```

`db:migrate:test` uses only `TEST_DATABASE_URL` and the committed SQL migrations. It bypasses Development migration configuration. Fixtures create unique users/movies/genres and clean up their rows; auth rate-limit records follow the library's expiry pruning. Playwright builds and starts an isolated app with the test database, a fixture auth secret, and terminal delivery; it overrides inherited Resend settings. Provider tests mock Resend/TMDB. CI uses the same flow with a throwaway PostgreSQL 18 service.

Stop/remove the example database with `docker stop vunu-test-db`. Never assign a live app database to `TEST_DATABASE_URL`.

## Feature navigation

| Feature/boundary | Files |
| --- | --- |
| Request authentication and redirects | `src/hooks.server.ts`, `src/lib/server/require-user.ts`, `sign-in-redirect.ts` |
| Auth configuration and runtime wiring | `src/lib/server/create-auth.ts`, `auth.ts`; browser client in `src/lib/auth-client.ts` |
| OTP abuse limit and delivery | `src/lib/server/sign-in-code-limit.ts`, `email.ts`; sign-in UI in `src/routes/sign-in/` |
| Seen-list UI and validation | `src/routes/seen/+page.svelte`, `+page.server.ts`, `SeenButton.svelte` |
| Catalog/seen-list reads | `src/lib/server/movie-search.ts` |
| Atomic, idempotent writes | `src/lib/server/actions.ts`, `seen-list.ts` |
| Database schema, relations, pool/TLS | `src/lib/server/db/`; migrations in `drizzle/` |
| Development catalog import | `scripts/seed-movies.ts`, `src/lib/server/tmdb/` |
| Test fixtures and isolated configuration | `src/lib/server/testing/`; colocated `*.spec.ts` and `*.e2e.ts` |
| Build/runtime/environment | `vite.config.ts`, `src/env.ts`, `vercel.json`, `.github/workflows/ci.yml` |

Svelte's `$state` and `$derived` update component state and computed values without a React dependency array. `+page.server.ts` supplies authenticated page data and form actions; `use:enhance` submits forms and refreshes that server data. The signed-in user comes from each server request, rather than a separate client auth store. Better Auth's browser client calls `/api/auth/*` so its HTTP rate limits and origin checks run.

## Commands

| Command | Purpose/side effects |
| --- | --- |
| `bun run dev` | Local Vite server, port 5173 |
| `bun run verify` | Frozen install (so checks run against the lockfile's versions), format/lint, type check, Vitest unit/browser/database tests |
| `bun run test:e2e` | Installs Chromium if needed, builds, and runs Playwright on port 4173 with isolated settings |
| `bun run build` / `bun run preview` | Build Vercel output / serve the local production build |
| `bun run fix` | Writes formatting and ESLint fixes |
| `bun run db:migrate:test` | Applies migrations only to the explicitly selected disposable test DB |
| `bun run db:generate` | Generates new SQL migrations from schema changes; review and commit them |
| `bun run db:migrate` | Applies migrations to `.env.local`'s Development database, or deploy-provided settings |
| `bun run db:seed` | Calls TMDB and writes/upserts the small Development catalog; requires its token; rejects hosted Preview/Production |
| `bun run db:studio` | Opens a database editor for the configured database |
| `bun outdated` | Checks stable package updates without upgrading them |
| `bun run outdated:next` | Checks remaining pinned prereleases (Drizzle ORM/Kit) without upgrading them |
| `vercel env ls` | Lists variable names per Vercel environment, without values (read-only) |

`bun install` sets up a pre-commit hook ([simple-git-hooks](https://github.com/toplenboren/simple-git-hooks), configured in `package.json`) that runs `bun run lint`. Skip it once with `git commit --no-verify`. ESLint also enforces two write paths: only `seen-list.ts` writes `seenMovies`, and only `actions.ts` writes `actions` (tests are exempt).

Vercel's configured build runs `db:migrate` before `build`, so a deployment writes to its selected database. New migrations must remain compatible with the preceding deployment.

Only `main` deploys: `vercel.json` disables Vercel Git deployments for every other branch (`"**": false`), so PR branches get CI but never a hosted build or migration. Revisit when Preview is provisioned.
