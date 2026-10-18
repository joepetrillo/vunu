# Vunu Movie Finder

SvelteKit app that finds movies nobody in a group has seen. Full spec, scope, and decision reasoning: `docs/PROJECT_SPEC.md`. Read it before planning any feature, and update it when a decision changes.

## How to work with me

- I'm an Angular/React developer learning Svelte 5 and SvelteKit. Act as a mentor: explain decisions in plain language, give options with tradeoffs and a recommendation, and ask my opinion before locking in anything significant.
- Work in small steps. Follow the build order in spec section 8 and don't implement ahead of the current stage. Check the Progress list there to see where we are. A stage is done only when its "Done when" checks pass; then commit, deploy, and update Progress. Before a stage, explain the concepts it teaches; after writing code, explain what each piece does and why. Point out where Svelte differs from Angular/React.
- Respect the task's branch/deployment scope. Reviews and audits are not product stages and don't authorize deploys or pending live checks.
- Be concise. No filler.
- Svelte 5, SvelteKit, Better Auth, and Drizzle change fast: check current docs rather than relying on memory.

## Version-sensitive APIs (easy to get wrong from memory)

SvelteKit 3 is stable; Drizzle v1 is still an RC. Most older tutorials use SvelteKit 2 and Drizzle 0.x. Use the installed major's APIs:

- **SvelteKit 3:** import from `#lib/...` with file extensions (`#lib/server/db/index.ts`), not `$lib`. Use `$app/env`, not `$app/environment`; `$app/state`, not `$app/stores`; `refreshAll`, not `invalidateAll`. Declare the app's env vars in `src/env.ts` (`defineEnvVars`) and import them from `$app/env/private` or `$app/env/public`. Scripts in `scripts/` run outside Kit, so they validate `process.env` themselves with Zod. Docs: https://svelte.dev/docs/kit. No remote functions (still experimental).
- **Kit 3 form actions:** a relative action (`action="?/add"`) replaces the page's query string. Keep search/filter params and strip existing `/action` keys before appending the new one (Kit chooses the first). See `src/routes/seen/SeenButton.svelte` and `sign-in-redirect.ts`. Enhanced redirects are JSON action envelopes; ordinary forms must request HTML to receive an HTTP redirect.
- **Drizzle v1:** `drizzle({ client, relations })`, relations via `defineRelations`, relational queries v2. Docs: https://orm.drizzle.team (v1 pages). Better Auth uses `@better-auth/drizzle-adapter/relations-v2`.
- Kit, the Vercel adapter, drizzle-orm, and drizzle-kit are pinned to exact versions. At the start of each stage, use `bun outdated` for stable packages and `bun run outdated:next` for the remaining Drizzle prereleases. Upgrade deliberately, in pairs (kit + adapter-vercel, drizzle-orm + drizzle-kit), then `bun run verify` and relevant browser tests.

## Svelte AI tools

The Svelte MCP server (`svelte`) and the `svelte-code-writer` / `svelte-core-bestpractices` skills are installed.

- **Svelte 5:** look things up with `get-documentation` (call `list-sections` only when you don't know the section path). Load `svelte-core-bestpractices` before writing components.
- **SvelteKit:** check the MCP documentation's major version before using it. If it describes Kit 2 (`$lib`, `$app/environment`, `svelte.config.js`), fetch the Kit 3 page instead: `https://svelte.dev/docs/kit/<slug>/llms.txt`, where `<slug>` is the MCP path without `kit/` (e.g. `form-actions`, `$app-env`). Migration guide: `https://svelte.dev/docs/kit/migrating-to-sveltekit-3/llms.txt`. Resolve disagreements against installed types and matching tagged source.
- **Updating skills:** `bunx skills update` skips these two (upstream mirrors them in several folders; [vercel-labs/skills#2231](https://github.com/vercel-labs/skills/pull/2231)). Until that ships, re-add them: `bunx skills add https://github.com/sveltejs/ai-tools/tree/main/plugins/claude/svelte/skills --skill svelte-core-bestpractices --skill svelte-code-writer`.
- **Validate:** after creating or editing any `.svelte`, `.svelte.ts`, or `.svelte.js` file, run `svelte-autofixer` on it and repeat until it returns no issues or suggestions. If the MCP isn't connected, use the CLI from `svelte-code-writer` (`npx @sveltejs/mcp svelte-autofixer <path>`).
- **`playground-link`:** only for code not written to project files, and only after asking me.

## Code rules

- No `any`; use `unknown` and narrow. Validate all external input (forms, URL params, TMDB responses, env vars) with Zod 4 and derive types from the schemas (`z.infer`).
- Use SvelteKit's generated `$types`, Drizzle schema types, and typed `$props`.
- Svelte 5 runes only. Use `$effect` only when nothing else works.
- Server-only code (database, secrets, TMDB) lives in `src/lib/server` (imported as `#lib/server/...`). Forms use form actions with `use:enhance`. Working without JavaScript is not a goal: take it when it's free, never add complexity for it.
- UI uses shadcn-svelte (Maia style) in `src/lib/components/ui`; the code is ours to edit. Page layout: `Page.svelte` (safe areas, back link, large title), `ListGroup.svelte` (inset grouped lists), and `NavRow.svelte` (a list row that opens another screen). Add components with `bunx shadcn-svelte@latest add <name>`, then fix what it generates: `#lib/....ts` import extensions, per-icon Hugeicons imports (ESLint enforces), and lint. Its `Button` defaults to `type="button"`: form buttons need `type="submit"`. Never the browser's `confirm()`/`alert()`/`prompt()`: questions before a hard-to-undo change use `ConfirmDialog.svelte` (shadcn alert-dialog), whose confirm calls the form's `requestSubmit()`. Theme: Light, Dark, or System (the default), picked on the home page and kept in this browser's localStorage. The server can't read it, so the toggle renders with nothing selected (its description held in place, unseen) until the app hydrates; never guess System or move the pick to a cookie. The inline script in `app.html` puts the `dark` class on `<html>` before the first paint; `#lib/theme.svelte.ts` (a `Theme` shared through context from the root layout) takes over after that, and `theme.svelte.spec.ts` checks the two agree. Fonts: Geist and Geist Mono. Codes are typed into `CodeInput.svelte` (shadcn input-otp), which submits its form when the last box fills. Design: mobile first, with generous spacing and padding and big tap targets, using the default shadcn/Maia components; don't imitate iOS-specific patterns (collapsible sections and the like), and avoid layout shift (no summaries that grow as people pick options). Text wrapping: headings balance and other text wraps `pretty` by default (`layout.css`); add `text-balance` to a sentence or two under a heading and to centered text. Text built from data goes through `#lib/format.ts`: counts (`formatCount`, "1,284"), lists of names (`listNames`, which stops at three and counts the rest), and detail lines (`joinDetails`, whose separators never start a line). Long names with no spaces use `wrap-anywhere`, not `break-words`, which can't stop them widening a row.
- Exception: sign-in and sign-out use Better Auth's browser client (`#lib/auth-client.ts`), not form actions. Better Auth applies its rate limits and origin checks only to HTTP requests through `/api/auth/*`; calling `auth.api.*` from server code skips them.
- Comments explain _why_ and non-obvious logic, not what the code says: short one- or two-liners above the relevant line (e.g. "Runs once per instance: Node caches modules, so every import shares this pool."). Briefly explain Svelte-specific patterns and platform behavior the same way.
- Never commit secrets. Keep `.env.example` in sync with variable declarations in `src/env.ts`, script validation, and test configuration; do not create `.env`.

## Architecture rules (easy to get wrong)

- Prefer deriving state from stored facts over storing extra state.
- Database: `pg` pool via Drizzle's `node-postgres` driver, created once at module level (max 1–2), `DATABASE_URL` = Neon pooled string, `DATABASE_URL_UNPOOLED` for drizzle-kit only, registered with `attachDatabasePool`. Details: spec section 5b.
- Every pushed branch gets a Vercel Preview deployment with its own Neon database branch (`preview/<git-branch>`, copied from production by the Neon-Managed integration); `main` deploys Production. `production-guard.ts` makes Preview refuse Production's database, at migration and at runtime. Auth trusts a preview's exact hostnames (`VERCEL_URL`, `VERCEL_BRANCH_URL`), never `*.vercel.app`. Details: spec section 5b.
- Schema changes: edit `src/lib/server/db/schema.ts`, then `bun run db:generate` (writes a SQL migration to `drizzle/`, committed) and `bun run db:migrate` (applies it to the dev database). Never `drizzle-kit push`. Production migrates on deploy (`vercel.json` runs `db:migrate` before `build`) while the previous deployment still serves traffic, so every migration must work with the old code too (add, then backfill, then remove in a later deploy).
- Server code runs on Vercel Fluid compute: one instance serves many requests at once. Never keep per-request or per-user data in module-level variables; use `event.locals`. Shared clients (e.g. the database pool) belong at module level.
- Runtime wiring belongs in `auth.ts` and `db/index.ts`; `create-auth.ts` accepts a database, secret, and sender so the same HTTP auth boundary can be tested without real email. Keep origin/CSRF checks enabled in tests: Better Auth 1.7.7's test defaults disable them. Hosted Preview/Production must have a Resend key; only local development may log OTPs.
- TMDB is never called during a user session. The catalog comes from `movies`, filled by `bun run catalog:sync` (`#lib/server/tmdb/sync-catalog.ts`): locally into Development, and in Production only from the `catalog-sync.yml` GitHub Actions workflow (every 2 days, as the catalog-only `catalog_sync` role; the script refuses Production elsewhere). Progress is derived from `movies.details_synced_at`, so a run resumes by re-running. A new table the sync writes needs a `GRANT` to that role. Details: spec section 2.
- Per user, "seen" is stored in `seen_movies` and "Not seen" in `not_seen_movies`. A Not seen counts for 2 weeks (`answered_at`); answering again restarts it. A missing entry means unknown, never not seen. Old watch-session answers were not carried over.
- There are no watch sessions (stage 8, spec section 1): each group has one deck. Their tables, the log's watch-session columns, and the `watch_*` action types were dropped after stage 8 shipped. `sessions` is Better Auth's login-session table.
- Matches are derived: every current member has a fresh Not seen, no member has it on their seen list, and the group hasn't marked it watched (`group_watched_movies`, a group-only record that never touches seen lists). Never stored; preferences and catalog data don't affect existing matches.
- Preferences ("In the mood for") are per visit: URL query only (`maxRuntime`, `minYear`, `maxYear`, `genreIds`, parsed by `preferencesFromQuery` in `#lib/deck-fields.ts`), never stored. They only pick new movies: movies others already confirmed are dealt whatever the preferences.
- Deck order: most confirmations from other members, then weighted rating (Bayesian: 500 votes at 6.5), then movie ID. Only movies with at least `VOTE_COUNT_FLOOR` votes and a past US release are dealt. No cursors or offsets: deal the top eligible unanswered movies, excluding ones already on screen.
- Every server operation checks the permission it needs (answering requires membership in the group; see spec section 4). The acting user comes from the auth session, never from request data.
- Every application-domain mutation carries a client action ID and runs through `runAction` (`#lib/server/actions.ts`): logged in `actions` and applied in one transaction that bumps every affected counter (`groups.revision` and/or `users.seen_version`). Better Auth owns its separate authentication protocol. The browser keeps an ID until the server answers, so a retry resends it. ESLint rejects writes to `actions` outside `actions.ts`.
- All seen-list changes go through one server module: `#lib/server/seen-list.ts` (ESLint rejects writes to `seenMovies` elsewhere; tests are exempt).
- All group and membership changes go through `#lib/server/groups.ts` (ESLint rejects writes to `groups`, `groupMembers`, `inviteLookupLimits` elsewhere). Each change locks the group's row first (`SELECT … FOR UPDATE`), so membership changes to one group run one at a time. Non-members get `not_found`, the same as a missing group. Screens under `/groups/[groupId]` get the group (and the membership check) from its `+layout.server.ts`; a page load awaits `parent()` before reading more, and form actions rely on the server modules' own checks (layout loads don't run for actions). In the browser, new forms that send an action ID use `ActionForm` (`#lib/action-form.svelte.ts`); `SeenButton.svelte` predates it and keeps its own copy of the same rule.
- All deck changes go through `#lib/server/group-deck.ts` (ESLint rejects writes to `notSeenMovies` and `groupWatchedMovies` elsewhere). An answer or undo locks the user's row (answers are about the person and count in every group); We watched this locks the group's row. Undo is per group deck: your answers logged with that group, newest first; it restores your previous answer to that movie from any group. In the browser, the deck's answers go through the save queue in `src/routes/groups/[groupId]/find/deck.svelte.ts` (one at a time, action IDs kept until answered); only the visible card is fixed.
- Live updates: the server bumps `groups.revision` (`notifyGroupChanged()` in `groups.ts`) or `users.seen_version` (`bumpSeenVersion()` in `seen-list.ts`); the client polls through `subscribeToDeck()` (`#lib/deck-updates.ts`). The fingerprint is the group's revision + every member's seen version + how many of the members' Not seens still count (an expiry writes nothing, so the count notices it); nothing else may poll or depend on the mechanism. Deck state is read in one snapshot with its fingerprint (`readDeckState`/`pollGroupDeck`); a save or undo calls the subscription's `hold()` so polls pause and stale replies are dropped.

## Commands

Package manager is **bun**. Command list and setup: README "Commands" and "Safe test setup".

- `bun run verify` = frozen install + lint + svelte-check + Vitest (`--run`; Vitest defaults to watch mode). The pre-commit hook runs `bun run lint`.
- Database tests and e2e need a disposable `TEST_DATABASE_URL` exported in the shell. They never fall back to `DATABASE_URL` or read `.env.local`. Apply migrations to it with `bun run db:migrate:test`, never `db:migrate`.

Env files (why: spec section 5b):

- Vercel is the source of every variable. `vercel env pull` writes Development values to `.env.local`, overwritten on each pull: never hand-edit it, never create `.env` or `.env.development.local`. `vercel env ls` lists names per environment (read-only).
- Nothing local writes to Production. Don't add local production scripts (ask first if one seems unavoidable), and never use `vercel env run -e production` (it silently targets dev).

## Before finishing any change

Run `bun run verify` (plus e2e tests when relevant) and show the results. If no `TEST_DATABASE_URL` is set, say which suites didn't run instead of reporting a pass. Fix root causes; don't suppress errors.
