# Project Spec: Group "Unseen Movie" Finder

Full product spec and decision log. `AGENTS.md` holds the short, always-loaded rules; this file holds the details and the reasoning behind them. Update it when decisions change.

**Design principle for correctness:** prefer deriving state from a few stored facts over storing and syncing extra state. Simple but strong.

## 1. The product

**Problem:** finding something to watch as a group takes too long.

**Core idea:** the app finds movies that **nobody in the group has seen**. It does NOT judge whether people _want_ to watch them. Picking from the result is up to the group, outside the app.

**Principle:** users should do the least possible. One simple action at a time. No long lists to think through.

Movies only. US region only (release dates, age ratings). TV shows are a possible later addition.

### Users and groups

- Users sign up and can join multiple groups (group cap around 20 members, not final).
- Each user has ONE personal **seen list**, tied to the user, shared across all their groups.
- Only "seen" is stored per user. **"Not seen" is NOT remembered across sessions** (keeps data simple and never stale). Re-asking about popular movies is an accepted cost.
- A movie missing from someone's seen list means **unknown**, never "not seen".

### Sessions

- **One active session per group.** Tapping **Find a movie** while one is active offers **Resume** or **Start fresh** (which closes the old one).
- The person who starts it is the **host** and picks **who's watching tonight** (a subset of the group). Solo sessions are allowed.
- Optional filters (see Filters). **Changing filters starts a new session.**
- Sessions **auto-close after 24 hours** without activity. The timer resets only on successful user changes (answers, undo, participant changes), never on reads, polling, or duplicate retries. The host can close one anytime. Closed sessions reject all changes.

### Answering

1. The app deals a deck: movies matching filters, minus anything any participant has seen.
2. Each participant answers on their own device, one movie at a time, with two big buttons: **Seen** / **Not seen**. Swipe gestures are an optional extra, never the only input. No hearts, crosses, or like/dislike styling.
   - **Seen** adds the movie to that user's seen list and eliminates it from the session. Others see this on their next refresh (a few seconds).
   - A Seen answer on a movie someone else already eliminated **still updates your seen list**. A late Not seen on an eliminated movie is ignored.
3. A movie is a **match** when every current participant has answered **Not seen** and none of them has it in their seen list. Matches are derived from answers only; filters and catalog data decide only what gets dealt next, so a catalog sync can't break an existing shortlist.
4. At **5 matches** the app prompts the group to review the shortlist. Not a hard stop: the first match is viewable as soon as it exists, and people can keep going ("Find more").
5. People can answer at different times and resume where they left off.

### Session states (show the right one)

Each is a distinct message and UI state:

- **You're caught up:** you've answered everything available; others still have work.
- **Waiting for others:** candidates exist that only need other participants' answers. Show who hasn't answered. Never suggest loosening filters here.
- **No eligible movies:** the filtered pool is truly exhausted. Suggest which filter to loosen, based on actual remaining counts.
- **Something failed:** a request error. Distinguish "saving…" from "failed, retry".

### Participants

- Joining a running session requires the person to **accept the invite**. That's the only confirmation; it has nothing to do with answering movies.
- The host can **remove** a participant. Removing someone **deletes their answers in that session**, and matches recalculate from the remaining participants.
- Each join is a separate **participation** (its own ID). Rejoining starts fresh, and requests tied to an earlier participation are rejected.
- A session always has at least one participant. If the host leaves the session or group, the longest-standing participant becomes host; if nobody is left, the session closes. Leaving a group removes the person from that group's active session.
- Inactivity is never treated as "Not seen".

### Deck ordering

Sort key, in order:

1. **Previously matched movies last:** movies that were matches when one of this group's earlier sessions closed. Only history recorded **before this session started** counts, so another session can't reshuffle this one.
2. **Most Not seen confirmations** from other participants first ("finish what's started"), so each answer is likely to complete a match.
3. **TMDB vote count**, descending (a proxy for how well-known a movie is; well-known movies are most likely seen, so they get eliminated fast).
4. **Movie ID** as a stable tie-breaker.

Other rules:

- **No cursors or page offsets.** Each fetch asks for "the top few eligible movies I haven't answered, excluding the ones already on my screen." Rankings shift as people answer, so a saved position would skip movies.
- The card a person is looking at never changes under them. If someone else eliminates it meanwhile, skip it with a short note.
- Minimum vote count floor to avoid obscure titles. Unreleased movies (US) excluded.
- TMDB **popularity** (a daily activity score) and TMDB **trending** (separate day/week lists) are different metrics. Neither is used in v1.
- **Validate the ordering** once real data exists: measure time to first match and answers needed to reach 5 matches.

### Past-match history

- Recorded **only when a session closes**: whatever is a match at that moment is saved for the group. Matches undone before closing are never recorded. Reading data never records history.

### Filters (v1)

- **Runtime** (max minutes), **genre**, **release year** (range), **TMDB rating** (minimum).
- Multiple genres mean **any of** (OR).
- Movies missing runtime or rating are excluded only when that filter is active.
- Later: actor (and whether it means top-billed only), age rating, trending mode.

### Fixing mistakes and managing data

- **Undo** is always visible while answering. Each person has their own undo stack **per session**; repeated undo steps back through that person's actions in that session only.
  - Undoing a Seen removes the seen entry only if **this action was the last one to confirm it**. If a later action (another session, the My Seen Movies page) confirmed it again, the entry stays.
  - Undoing a Not seen withdraws that confirmation, so the movie may leave the shortlist.
- **"Actually, I've seen this"** on shortlist items.
- **My Seen Movies** page: search by title, filter (genre, year, etc.), remove entries.
- **Removing a seen entry lets your earlier Not seen answers count again.** They were your own answers, so if the Seen was a mistake, they're correct. (Deliberate rule; no extra invalidation logic.)
- All seen-list changes (answers, undo, corrections, page edits) go through **one server module**.
- Always show year and poster (remakes share titles).
- **Where to watch:** an external link only (e.g. TMDB's watch page), with no promise the movie is actually available.

### Scope

**v1:** auth, groups, one active session per group with Resume/Start fresh, host and "who's watching tonight", invites, host removal, host transfer, 24-hour auto-close, v1 filters, Seen/Not seen answering, shortlist with review prompt and Find more, deck ordering including past-match deprioritizing, per-session undo, shortlist correction, My Seen Movies page, the four session states, unreleased excluded, where-to-watch link.

**Later:** optional warm-up for new users (about 50 most-rated movies), Letterboxd CSV import, "allow 1 person who's seen it" leniency for big groups (off by default), actor/age-rating/trending filters, IMDb/Rotten Tomatoes scores via OMDb, verified streaming availability, real-time updates, TV shows.

## 2. Movie data: TMDB with our own catalog copy

- Source: **TMDB** (The Movie Database), a free community API. Its vote counts are smaller than IMDb's, but its relative order is good enough for "how well-known" ordering and a basic rating filter.
- TMDB cannot exclude our users' seen movies, so filtering happens on our side.
- **Chosen approach: keep our own copy of the catalog in Postgres.** TMDB is never called during a user session.
- **Seed:**
  - TMDB discover results stop at 500 pages, so split discovery into partitions (e.g. by release year, smaller ranges where needed) so each stays under the limit.
  - Discovery results and ID exports are not full records, so enrich each movie separately with a details request (runtime, genres, US certification, IMDb ID, etc.).
  - Run the first seed locally (too long for serverless).
- **Refresh (scheduled, GitHub Actions):**
  - Use TMDB's changes feed for edited movies, but **do not assume it covers vote-count changes**; verify, and refresh vote counts/ratings on a separate periodic job.
  - Periodically re-discover to catch movies newly crossing the vote floor and new US releases.
  - Sync must be **resumable** (records progress), **manually runnable**, and **monitored** (failed or missed runs alert).
- Store: title, year, US release date, runtime, genres, US certification, rating average, vote count, poster path, IMDb ID, last-synced time.
- Posters load directly from TMDB's image CDN; store only the path.
- **Before launch:** read TMDB's API terms (attribution, data storage rules).
- Rejected: fetching from TMDB live and filtering page by page. Too many API calls, slow for users with big seen lists.

## 3. Data model (starting point, to refine together)

**Naming:** the product's "session" (finding a movie together) is a **watch session** in schema and code, because `sessions` is Better Auth's login-session table (decided Sep 30 2026, stage 3). The UI still says "session".

- **users** (+ `seen_version` counter), plus Better Auth's other tables: **sessions** (login sessions), **accounts**, **verifications** (sign-in codes), **rate_limits**. Better Auth's `usePlural` option gives these plural names to match ours (`user` would also be a reserved word in Postgres).
- **groups**, **group_members** (role: owner/member)
- **movies** (catalog copy), **movie_genres**
- **seen_movies** (user, movie, created_at, `last_confirmed_by_action`), primary key (user, movie), which also serves lookups by user. Built in stage 4 without `last_confirmed_by_action`, which only undo reads (stage 6). Named `seen` until stage 4; renamed because the other tables are plural nouns.
- **watch_sessions** (group, host, filters, status active/closed, `revision` counter, last_activity_at); at most one active per group (partial unique index)
- **watch_session_participants** — one row per participation (ID, watch session, user, status invited/active/removed, joined_at)
- **watch_session_answers** (participation, movie, answer), unique per participation+movie; current answers only
- **actions** — action log for idempotency and undo: action ID (client-generated, primary key), user, participation, type (seen / not_seen / undo / seen_list_remove / …), movie, result, undone flag, created_at. Reusing an action ID with a different payload fails. The payload is compared column by column (user, type, movie, later participation) rather than through a stored hash: it's a few typed columns, so a hash would only hide them. Stage 4 built ID, user, type (`seen_list_add`, `seen_list_remove`), movie (NOT NULL until an action without a movie arrives), and created_at; the other columns come with the stages that need them.
- **group_past_matches** (group, movie, recorded_at), written when a session closes
- The **shortlist is derived**, never stored.

## 4. Correctness rules

- **Authorization:** each operation checks the permission it needs. Answering and undo require an active participation; accepting an invite requires a pending invite; viewing a session (including closed ones) requires group membership; seen-list edits only need to be your own list; host actions require being host. The acting user always comes from the login session, never from request data.
- **Idempotency:** every mutation carries a client-generated **action ID**. Retrying a request that already succeeded returns the stored result and changes nothing.
  - Server: `runAction` (`#lib/server/actions.ts`) logs the action and applies the change in one transaction, returning `applied`, `duplicate` (a retry; nothing changes), or `conflict` (the ID was used for a different action). A failed change rolls back its log entry, so only successful actions are recorded and a retry of a failure runs normally. A double submit waits on the primary key and is applied once.
  - Browser: one action ID per intended change, kept until the server answers. After an error with an unknown outcome (dropped connection, server error), trying again resends the same ID. Seen-list edits have no result worth storing (the page reloads its data); a `result` column comes with the first action that needs one.
- **Transactions:** each mutation (answer, undo, participant change, seen-list edit) runs in one transaction that bumps **every counter it affects**. A Seen answer changes both the session and the user's seen list, so it bumps `watch_sessions.revision` and `users.seen_version`.
- **Stale requests:** answers carry their participation ID and movie ID. Requests for an old participation or a closed session are rejected. A late Not seen on an eliminated movie is ignored; a Seen always updates the seen list.
- **Driver:** one TCP connection pool (see section 5b); transactions work over it directly.
- **Required tests:** simultaneous answers on the same movie, retry after a successful save, action ID reused with different input, undo conflicts (Seen confirmed again elsewhere), cross-session seen updates, participant removal and rejoin, host leaving, stale poll responses, session closure.

## 5. Updates between users: polling, designed to be swappable

- v1 uses **polling**, not WebSockets. Small groups, a few seconds of delay is fine, and Vercel serverless can't hold WebSocket connections. WebSockets would still need all of the consistency logic below (phones drop connections), plus a separate service and channel auth. Revisit only if real use shows the delay bothers people.
- **Change detection with a fingerprint:** the poll compares a small fingerprint built from the session's `revision` plus each active participant's `seen_version`. A seen-list change bumps only that user's counter, and every session they're in notices automatically. No cross-session writes or locking.
- When the fingerprint changed, the server returns full state and the new fingerprint from **one consistent read**.
- The client applies only the response to its **latest** request. Polls never overlap.
- **Coordinate polling with saves:** while a save is in flight, pause polling and discard any refresh response that started before the save, so it can't overwrite the save's result. Refresh once the save completes. Poll every 2–3 seconds while a session screen is open and visible; pause when backgrounded; back off when nothing changes; refresh immediately on focus/reconnect.
- An unchanged fingerprint gets a tiny "no change" response.
- A user's own answer response returns fresh state; polling only catches other people's changes.
- **Swappable boundaries:**
  - Server: `notifyWatchSessionChanged(watchSessionId)`, called on watch session changes (bumps revision). Seen-list changes bump `seen_version` in the seen-list module.
  - Client: `subscribeToWatchSession(watchSessionId, onChange)`, polls and reloads only when the fingerprint changed.
  - Switching to a real-time service (Ably/Pusher/PartyKit, or self-hosted WebSockets + Redis pub/sub) means rewriting only these boundaries; the fingerprint logic stays as the safety net.

## 5b. Database connections

Server code runs as Node.js functions on Vercel **Fluid compute**: one warm instance serves many requests at once, so it can hold and reuse connections like a small traditional server. Following Neon's and Vercel's guidance for that setup:

- **Driver:** `pg` (node-postgres) with Drizzle's `node-postgres` driver. Normal TCP connections, so interactive transactions work. No HTTP or WebSocket driver needed.
- **One pool per instance, at module level** (`src/lib/server/db/`), `max` 1–2 connections. Never create a client inside a request handler.
- **`DATABASE_URL` = Neon's pooled connection string** (hostname contains `-pooler`). Neon's PgBouncer multiplexes many client connections onto a few real Postgres connections, which prevents the "connection storm" when instances scale up.
- **`DATABASE_URL_UNPOOLED` = the direct (non-pooler) string**, used only by `drizzle-kit` for migrations, which need a real session. (Named by Neon's Vercel integration, which sets both variables on Vercel for every environment.)
- **`attachDatabasePool(pool)`** from `@vercel/functions` closes idle connections before Vercel suspends an instance, so they don't leak.
- **Region:** create the Neon project in AWS `us-east-1`, next to Vercel's default function region `iad1`.
- **Provisioning:** Neon's Vercel Marketplace integration (Free plan, `iad1`, Neon's managed auth off because we use Better Auth). Same plans and prices as a direct Neon account; billing and plan changes go through Vercel, and the Neon CLI needs an API key instead of `neon login`.
- **Databases per environment:** Vercel's Production and Development environments point at separate Neon endpoints, so local work never touches production data. Preview has no database yet, so `vercel.json` deploys only `main`; PRs get CI but no Vercel build. Enable Neon preview branching (plus a Preview secret, email key, and trusted host) if we want PR previews.
- **Local setup:** Vercel holds every variable (including `TMDB_READ_ACCESS_TOKEN`, a Development-only Secret: the deployed app never calls TMDB, and Production Secrets can't be pulled); `vercel env pull` writes the Development values to `.env.local`, the only local env file. drizzle-kit only auto-loads `.env`, so `drizzle.config.ts` loads `.env.local` explicitly; without that, migrations went to whatever `.env` held (this happened once, Sep 30 2026). No local command targets Production: it changes only through deploy-time migrations and the stage 9 sync job (GitHub Actions, values from repo secrets). A local Production seed script existed briefly and was removed: it had to layer a Production pull over `.env.local` (the TMDB token is Development-only, and `vercel env run -e production` silently overlays `.env.local`), and a laptop-to-Production path is the risk that caused the Sep 30 migration.
- **Migrations:** `drizzle-kit generate` writes SQL files to `drizzle/` (committed); `drizzle-kit migrate` applies them (locally: dev database). Production migrates during every Vercel deploy (`vercel.json` build command: `db:migrate && build`). The old deployment keeps serving until the new one is ready, so migrations must be backward compatible; a failed migration fails the deploy and the old version keeps running. Never `drizzle-kit push`.
- **TLS:** Neon's URLs say `sslmode=require`; `withVerifiedTls` (db/url.ts) rewrites it to `verify-full` so certificate checks survive pg v9, where `require` stops verifying. URLs without `sslmode=require` (CI's local Postgres, which has no TLS) are left alone.
- **Tests:** database tests (Vitest and Playwright) require an explicitly disposable `TEST_DATABASE_URL`; they never fall back to the app's `DATABASE_URL`. `bun run db:migrate:test` applies committed migrations to that database without loading Development migration settings. Each test creates unique users/movies/genres and deletes them afterwards. Playwright builds with the test database, a fixture auth secret, and terminal-only email; provider tests use mocks. CI supplies a throwaway Postgres 18 service container (Neon runs 18), with migrations applied first (`.github/workflows/ci.yml`). Shared helpers: `#lib/server/testing/`; setup: README.
- Rejected: Neon's HTTP driver (can't run interactive transactions; built for one-request-per-instance platforms) and its WebSocket driver (for runtimes without TCP, like edge; we don't use edge, and Kit 3 dropped edge support on Vercel).
- Sources: [Neon serverless connection pooling](https://neon.com/docs/guides/serverless-connection-pooling), [Vercel Fluid compute](https://vercel.com/docs/fluid-compute).

## 6. Tech stack (decided)

| Area | Choice | Why |
| --- | --- | --- |
| Framework | Svelte 5 + SvelteKit 3.0.0 (stable, pinned), Vercel adapter 7.0.0 | Learning goal. Adopted before stable (Sep 2026); upgraded the framework/adapter pair to stable in the Oct 2026 audit. Existing Kit 3 APIs retained |
| Language | TypeScript (strict) |  |
| Styling | Tailwind CSS |  |
| Components | shadcn-svelte (built on Bits UI), Bits UI directly for custom pieces | Headless, accessible, owned code |
| Database | Neon Postgres | Relational data; the deck is a SQL exclusion query |
| DB library | Drizzle v1 release candidate, pinned (`node-postgres` driver over Neon's pooler; see section 5b) | Reads like SQL, so it teaches what's happening. v1 chosen so the relations/query API learned is the one that stays; Better Auth supports it via its relations-v2 adapter |
| Validation | Zod 4 | All external input (TMDB, env vars, later forms and URL params); types come from `z.infer`. Chosen over Valibot/ArkType (Sep 2026) for familiarity and ecosystem: Better Auth already depends on it, Kit's `defineEnvVars` accepts it (Standard Schema) |
| Auth | Better Auth, **email one-time code only** (email OTP plugin), encrypted OTP storage with resend reuse | Works across devices (read email on laptop, sign in on phone), unlike magic links. No passwords. Encryption keeps pending codes out of database dumps while preserving the same code on resend; unused verification/password/email-change routes are disabled |
| Auth rate limits | Better Auth's per-IP limits with **database storage**, loosened (10 code emails per 10 min, 10 sign-in attempts per min), plus **our own per-email limit** (3 code emails per 10 min per address, `sign_in_code_limits`, enforced in a Better Auth `before` hook) | In-memory limits don't work across serverless instances. People in one room share an IP (Wi-Fi NAT, carrier NAT, one IPv6 /64), so per-IP limits must leave room for a group; the per-email limit is what protects an inbox, and a refused request never replaces the pending code. Guessing is stopped by each code's 3-attempt limit. Sessions stay at Better Auth's default: 7 days, extended on use |
| Login email | **Resend** on hosted Production and Preview; locally, without a key, the code is printed to the terminal | Hosted environments fail server initialization without a key. Until a domain is verified, Resend only delivers to the account owner's address: fine for stage 3, a domain is needed before a second person signs up (stage 5). Sign-up is open to any email; request/code limits constrain abuse |
| Hosting | Vercel | Near-zero config for SvelteKit |
| Catalog sync | GitHub Actions scheduled workflow (first seed run locally) | Free, no serverless time limits |
| Tests | Vitest (unit/integration), Playwright (end-to-end) | Database tests run against real Postgres (section 5b): transactions, locks, and constraints are what they test |
| Lint/format | ESLint (eslint-plugin-svelte + typescript-eslint strict type-checked) + oxfmt + svelte-check | See section 9 |
| Package manager | Bun |  |

Not needed for v1: WebSockets or real-time services, Redis, job queues (BullMQ), Kafka, a separate caching layer.

## 7. Open details to decide together

- Minimum vote count value
- Group size cap
- Exact polling intervals and backoff
- Group invite method (link vs. code) and who can invite
- How auto-close runs (checked on read vs. a scheduled job)

## 8. Project setup and build order

Project lives at `~/Documents/Projects/unseen`. Scaffolded with `sv create` (minimal, TypeScript) plus Tailwind, Drizzle (PostgreSQL + Neon), Vitest, Playwright, the Vercel adapter, and ESLint. Formatting uses oxfmt. Package manager: Bun.

### Build order (one stage at a time)

Design the schema with the whole spec in mind, but build features in stages. Each stage is a clean stopping point: when its "Done when" checks pass, nothing is half-built and nothing needs remembering.

**Every stage ends the same way:** lint, svelte-check, and tests pass; changes committed and deployed to Vercel; the Progress list below updated with the stage status and any follow-ups.

1. **Setup and deploy.** Tooling, strict TypeScript, env vars, CI. _Done when:_ the app loads at its Vercel URL, and CI runs lint, svelte-check, and tests green.
2. **Database and small catalog.** Drizzle + Neon (connections per section 5b; replace the scaffold's `neon-http` setup: remove `@neondatabase/serverless`, add `pg`, rewrite `src/lib/server/db/index.ts`), `movies` table, seed script for a few hundred movies. _Done when:_ a dev page lists seeded movies with posters, and re-running the seed creates no duplicates.
3. **Auth.** Better Auth with email codes, protected routes. _Done when:_ you can sign in with a code on phone and laptop, signed-out users get redirected, and an end-to-end test covers sign-in.
4. **Seen list.** The seen-list module (action IDs, transactions, `seen_version`) and the My Seen Movies page: add from a catalog search, search, filter, remove. _Done when:_ the page works on the live site, and tests prove a retried action changes nothing and a reused action ID with different input fails.
5. **Groups and invites.** Create a group, invite someone, permission checks. _Done when:_ a second account can join your group, and a test proves non-members can't read or change it.
6. **Solo session.** Session in a group with just you: deck query and ordering, filters, Seen/Not seen, matches, shortlist with "Actually, I've seen this", undo, where-to-watch link. _Done when:_ you can find unseen movies alone start to finish, and tests cover deck order, seen exclusion, filters, and undo conflicts.
7. **Group sessions.** Multiple participants, polling fingerprint, the four session states. _Done when:_ two browsers on different accounts see each other's answers within seconds and reach a shared match, and tests cover simultaneous answers, stale poll responses, and polling during saves.
8. **Session lifecycle.** Accepting session invites, host removal and transfer, rejoining, Resume/Start fresh, 24-hour auto-close, past matches. _Done when:_ each rule in the spec's Participants and Sessions sections has a passing test.
9. **Full catalog sync.** Partitioned seed, enrichment, scheduled GitHub Actions job, alerts. _Done when:_ the full catalog is loaded, a scheduled run succeeds, an interrupted run resumes, and a forced failure sends an alert.
10. **Launch.** TMDB attribution and terms check, production email provider, error pages, ordering metrics. Revisit: branch protection on `main` requiring the CI `verify` check (until then changes reach `main` by direct push or PR), and moving CI off the pinned `ubuntu-24.04` runner. _Done when:_ you and your brother use it for a real movie night.

### Progress

<!-- Update at the end of each stage: stage number, status, date, follow-ups. -->

- **Stage 1 — done (2026-09-30).** Scaffold, strict lint/type-check setup, oxfmt, CI workflow, `AGENTS.md`, SvelteKit 3 (pre-release at scaffold; stable upgrade recorded below) + Drizzle v1 (RC), Vitest 5, `outdated:next` script, database connection plan (section 5b), Svelte AI tools (remote Svelte MCP in `.cursor/mcp.json` + `.mcp.json`, skills in `.agents/skills`). Node pinned to `24.x` via `engines` (read by CI's `setup-node` and by Vercel). Repo: [joepetrillo/unseen](https://github.com/joepetrillo/unseen) (public). Vercel project `joes-projects-dab9d62e/unseen`, Git-connected (push to `main` deploys production); live at https://unseen-sooty-ten.vercel.app. Follow-ups for stage 2:
  - Vercel's `DATABASE_URL` (Production + Preview) is a **placeholder**: the build validates `src/env.ts`, but nothing queries the database yet. Replace it with the Neon pooled string and add `DIRECT_URL`.
  - `drizzle.config.ts` still reads `DATABASE_URL`; switch it to `DIRECT_URL` (section 5b).
  - `src/env.ts` validates with a hand-written function; switch to a schema once a validation library is added.
  - Example files (`src/lib/vitest-examples`, `src/routes/demo`) stay until stage 2 as working examples of tests.
- **Stage 2 — done (2026-09-30).** All stage 1 follow-ups resolved. Neon via the Vercel integration (separate Development and Production databases, section 5b); `pg` pool + Drizzle v1 with relations v2; `movies`, `genres`, `movie_genres` with the first migration; Production migrates on every deploy (`vercel.json`). Zod adopted for all external input. TMDB client + `toMovieRow` (unit-tested); seed of the 300 most-voted movies with details: second run inserted 0 and updated 300 (dev), Production seeded once from this machine (that script is now removed; see section 5b). `/dev/movies` lists them with posters, locally and at https://unseen-sooty-ten.vercel.app/dev/movies. Scaffold examples replaced by real tests (6 mapping, 2 component, 1 e2e). Follow-ups:
  - `/dev/movies` is public; remove it or put it behind auth in stage 3. (Done: behind sign-in.)
  - Preview deployments have no database variables. Since the audit, `vercel.json` deploys only `main`, so PR branches don't build on Vercel; enable Neon preview branching if we want PR previews.
  - Database integration tests (and a database in CI) start in stage 4, the first stage whose checks need them. (Done in stage 4.)
  - Learn how to reset the dev database (Neon branch `vercel-dev`) without pulling Production's data into local testing: empty it (drop the `public` and `drizzle` schemas on dev only), then `db:migrate` + `db:seed`, so dev holds seed data only. Avoid Neon's "reset from parent", which copies Production's rows once real user data exists. Possibly a `db:reset` script that refuses non-dev hosts. Revisit once stage 3 adds auth tables.
  - Vote-count floor (open detail) and the full, resumable catalog sync remain stage 9. Discover currently has no floor; the top 300 are far above any plausible one.
  - Build warns about optional modules (`pg-native`, `cloudflare:sockets`, `bufferutil`); harmless, they're never loaded on Vercel's Node runtime.
- **Stage 3 — done (2026-09-30).** Better Auth 1.7 with email codes only (email OTP plugin), Drizzle adapter (relations v2, `usePlural`): `users`, `sessions`, `accounts`, `verifications`, `rate_limits`, plus our `sign_in_code_limits`. Movie-finding sessions renamed **watch sessions** in spec and future schema, since `sessions` is Better Auth's. `hooks.server.ts` loads the session into `locals` and redirects every page except `/sign-in` (which returns you via a validated `redirectTo`); `/dev/movies` is now behind sign-in. Sign-in and sign-out use Better Auth's plain browser client (`better-auth/client`; the signed-in user always comes from the server as `data.user`), not form actions, because Better Auth applies rate limits and origin checks only to `/api/auth/*` requests (see AGENTS.md). Codes: Resend on Production (`onboarding@resend.dev`, delivers only to the Resend account owner until a domain is verified), printed to the terminal elsewhere, never logged on Production. Allowed hosts are explicit (`localhost:5173`, `localhost:4173`, `unseen-sooty-ten.vercel.app`); other Vercel URLs for the deployment won't sign in. Password and email-change endpoints disabled. e2e (3 tests, local only, dev database): redirect, sign-in with the code read from `verifications`, sign-out, per-email limit. Signed in on phone and laptop at the live URL. Follow-ups:
  - Verify a domain with Resend before a second person signs up (stage 5), and switch the sender.
  - The audit changed OTP storage to encrypted. e2e reads `sign-in-otp-<email>` fixtures and decrypts them using the isolated browser server's fixture secret; recheck the installed format after Better Auth upgrades. See `docs/AUDIT.md` for the pending-code rollout note.
  - New users get `name: ""`. Display names come with groups (stage 5).
  - The dev database reset follow-up from stage 2 now also covers the auth tables.
  - Svelte gotcha hit: `{...}` inside a quoted attribute is still an expression (`pattern="[0-9]{6}"` became `[0-9]6`).
  - **Review pass before stage 4 (2026-09-30)**, fixed:
    - All sign-in routing lives in `hooks.server.ts`: pages only call `refreshAll()` after signing in or out, and the hook redirects (`sequence` of Better Auth's handler, then the sign-in guard). `redirectTo` is checked by parsing it as a URL against our origin (#lib/server/sign-in-redirect.ts, unit-tested). The earlier string check let `/\t/evil.com` through, which browsers treat as `//evil.com`.
    - `resendStrategy: "reuse"`: asking again re-sends the pending code instead of replacing it, so any of the emails works. Before, a slow first email held a dead code.
    - Better Auth logs failed email sends and still reports success (on purpose, against timing attacks), so the code step says to check spam and offers "send it again". Production logs showed one such failure: a non-owner address hit Resend's test-mode restriction.
    - The sign-in page shows a message when the request never reaches the server (the button used to stay on "Sending…"), and plain-language messages for wrong, expired, or used-up codes.
    - The per-email limit normalizes like Better Auth (lowercase, then validate) and counts only sign-in codes. Before, some non-ASCII input skipped the limit, and other code types used it up without sending anything.
    - Vite uses `strictPort`, since Better Auth only trusts ports 5173 and 4173.
  - Checked and fine: Vercel sends a single client IP in `x-forwarded-for`, which Better Auth needs for per-IP limits (no IP warnings in Production logs). Several rows per code identifier in `verifications` is by design; only the newest counts.
  - Better Auth 1.7.7 does prune expired `rate_limits` rows in its database-store path. Our `sign_in_code_limits` has no pruning; revisit retention with the stage 9 scheduled jobs.
- **Stage 4 — built (2026-10-01); waiting on the live-site check.** `seen_movies`, `actions` (enum `action_type`), and `users.seen_version` in one additive migration (section 3). `runAction` (`#lib/server/actions.ts`) applies each action ID at most once, in one transaction with the change (section 4); `#lib/server/seen-list.ts` is the only code that changes seen lists and bumps `seen_version` only when the list really changed. `/seen` ("Seen movies"): two tabs, "Your list" (newest first) and "All movies" (the catalog, most-voted first), sharing a title search, genre and decade filters, and Previous/Next pages, all in the URL and validated with Zod (bad values fall back to defaults). Each row has a "Seen it" or "Remove" button: a form action with `use:enhance`, sending an action ID the browser keeps until the server answers. Form and URL IDs are validated with schemas from `drizzle-orm/zod`, so their bounds come from the columns. `/dev/movies` is gone; "All movies" replaces it. Posters use `srcset`, so list thumbnails download TMDB's small sizes. Tests: 7 database tests for the seen list (retry changes nothing, reused ID with different input fails, double submit applied once, failed change logs nothing), 2 e2e tests (add and remove through the page; a retry after a lost response is saved once, via Playwright dropping the first response). CI now runs the database tests against a Postgres 18 service (section 5b). Follow-ups:
  - Before stage 5: verify a domain with Resend and switch the sender (carried over from stage 3; the app name and domain aren't final yet).
  - Stage 6 adds `seen_movies.last_confirmed_by_action` and the `actions` columns for sessions (participation, result, undone); `actions.movie_id` becomes nullable when an action without a movie arrives.
  - Search is a plain `ILIKE '%…%'` on titles, ordered by vote count: instant at 300 movies. With the full catalog (stage 9), check its speed; a `pg_trgm` index would fix a slow title search, and the deck will want a `vote_count` index anyway. Accent-insensitive search (`unaccent`, "amelie" finding "Amélie") is a possible extra.
  - UI is plain Tailwind and native elements so far; shadcn-svelte (section 6) waits for screens that need real components, like the session.
  - Kit 3 gotcha hit: a relative form action (`action="?/add"`) replaces the page's query string, so a search disappeared after each save. The action URL now keeps it (`SeenButton.svelte`; also in AGENTS.md).
  - Chrome adds a space around visually hidden (`sr-only`) text when naming a button ("Seen it : Inception"), so row buttons use `aria-label`.
  - The dev database reset follow-up (stage 2) now also covers `seen_movies` and `actions`. Tests leave no rows behind.

- **Audit — merged to `main` (2026-10-03).** Inspected the current application and retained its route/form-action, pooled TCP database, and idempotent mutation design. Added disposable test configuration/migrations, encrypted OTP storage and a restricted auth surface, hosted email safeguards, database connection recovery/timeout handling, stale-action URL protection, deliberate missing-movie responses, sign-in/sign-out failure recovery and focus management, and validated/transactional catalog import coverage. CI now exercises browser journeys. Exact findings, versions, checks, limitations, and separate rollout steps are in `docs/AUDIT.md`. Only `main` deploys now (`vercel.json`); PRs get CI only. Encrypted code storage means codes sent before the deploy stop working (request a new one). This does not complete stage 4's live-site check or implement later stages.

- **Framework stable upgrade — merged with the audit (2026-10-03).** SvelteKit 3.0.0 and Vercel adapter 7.0.0 replace their prereleases; the existing Kit 3 application APIs need no migration. Other resolved dependency versions remain unchanged, including Drizzle v1 RC. Frozen install, format/lint, type checks, 90 regression tests, 15 Chromium journeys, and the production-mode Vercel Node 24 build passed. Stable documentation and remaining rollout gaps are recorded in `docs/AUDIT.md`. Stage 4's live-site check remains pending.

## 9. Linting and formatting decision

- **ESLint:** the official Svelte setup (`sv add eslint`: eslint-plugin-svelte, which understands markup, runes, and SvelteKit conventions) upgraded to typescript-eslint's **strictTypeChecked + stylisticTypeChecked** configs.
- **oxfmt** formats everything, including `.svelte` files, and sorts Tailwind classes (reads `src/routes/layout.css`). Config: `oxfmt.config.ts`. Chosen over Prettier (Sep 2026): its Svelte support is still labeled experimental, but on this repo and a stress-test component it produced output identical to Prettier + prettier-plugin-svelte + prettier-plugin-tailwindcss, with one tool instead of three. Fallback if it ever mangles a file: `oxfmt --migrate` has a Prettier counterpart, and Prettier's config is a few lines.
- `eslint-config-prettier` stays: it only switches off ESLint style rules so ESLint never fights the formatter.
- **svelte-check** with `--fail-on-warnings`.
- TypeScript `strict` plus `noUncheckedIndexedAccess`.
- CI (GitHub Actions) runs lint, svelte-check, unit/browser/database tests, and Playwright against a production build on pushes to `main` and pull requests.
- **Why not Ultracite:** tried at setup (Sep 2026). Its ESLint Svelte preset didn't configure the Svelte parser (every `.svelte` file failed to parse) and its rules clashed with SvelteKit conventions (`+page.svelte` file names, `.svelte.spec.ts` tests). Its Oxlint backend only lints `<script>` blocks. Revisit if either improves.
