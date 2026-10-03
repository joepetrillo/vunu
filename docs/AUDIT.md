# Application audit

Audit date: 2026-10-02. Baseline: `ed96a72caaddf79cca3505d5a9ddd78a191516a8`. Branch: `audit/correctness-security-2026-10-02`, reviewed and merged to `main` by pull request on 2026-10-03 (see [Merge](#merge-2026-10-03)). This file is a historical record of the audit; current status lives in the spec's Progress list.

The original version table and checks below describe the October 2 audit. The [stable-framework follow-up](#stable-framework-follow-up-2026-10-03) records the subsequently requested upgrade to SvelteKit 3.0.0 and Vercel adapter 7.0.0.

## Scope and architecture

Inspected every handwritten module under `src/` and `scripts/`, all routes, tests, environment declarations, CI/build/lint/editor configuration, the README, contributor instructions, product spec, and all four SQL migrations. Generated migration snapshots, the lockfile, installed dependencies, assets, and bundled skills were reviewed at their configuration/integration boundaries. Groups, watch sessions, polling, scheduled catalog sync, and webhooks do not exist yet and were not implemented as part of this audit. Stage 4 still requires its separate live-site check.

- `/api/auth/*` is handled by Better Auth before the application guard. Email OTP is the only configured login method; signup is deliberately open.
- `hooks.server.ts` reads the cookie/session into request-local `locals`. All application pages/actions require sign-in except `/sign-in`. The layout exposes only the user's ID and email.
- `/seen` loads a user-scoped catalog/seen-list query with URL filters. Enhanced forms send movie/action IDs; the acting user always comes from `locals`.
- `runAction` inserts the action log and applies the mutation in a single PostgreSQL transaction. Duplicate IDs wait on the primary key; payload reuse returns a conflict. The seen-list module alone changes entries and increments `users.seen_version` only on actual changes.
- A module-level `pg` pool (two connections), registered with Vercel, backs Drizzle's node-postgres driver. This supports interactive transactions; the app does not use Neon's HTTP/WebSocket drivers.
- TMDB is only called by the development seed script. Catalog data is validated/mapped and upserted transactionally. Posters load from TMDB's CDN. Resend is a server-only OTP delivery boundary.

## Baseline

Installed with Bun's frozen lockfile without changing it. Node 24.19.0 and Bun 1.4.2 were used. The repository requires Node 24.x; Bun is not currently pinned.

| Check | Baseline result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed |
| `bun run lint` | Passed |
| `bun run check` | Passed, zero errors/warnings |
| `bun run test:unit --run` | Passed: 27 tests in 5 files, including real PostgreSQL transactions and Chromium components |
| `bun run test:e2e` | Passed: 5 browser tests against a local production build |
| `bun run build` | Passed, Vercel Node adapter output |
| `bun audit --json` | Passed; empty advisory response |

All database writes/migrations/tests use a newly created, disposable local PostgreSQL 18.6 container on port 55432. No Development/Preview/Production credentials were pulled. Email-provider tests use mocks; local browser tests use reserved `example.test` addresses and terminal-only delivery. Initial tool setup encountered a missing Bun/browser cache and Docker Hub's anonymous pull limit; these were resolved using temporary tools/cache paths and the official image's public ECR mirror. The visual browser CLI needed Chromium's container launch flags; its compilation/browser operations stayed local. These are environment setup issues, not baseline application failures.

The build reports missing **optional** modules: `pg-native`, `cloudflare:sockets`, `bufferutil`, `utf-8-validate`, `@react-email/render`, and `@opentelemetry/api`. The application uses JavaScript pg on Node, text emails, and no optional tracing; the exercised runtime paths do not load these modules. Vitest also emits a plugin-hook compatibility warning; baseline tests pass with it. No checks were suppressed.

## Prioritized findings

Severity describes consequence, not preferred style. Every correction below is implemented on the audit branch. Confirmed defects, hardening, and maintainability improvements are labeled separately; unresolved questions follow the table. Verification names refer to the colocated regression files.

| ID | Category; severity/confidence | Location and evidence | Consequence | Correction and verification |
| --- | --- | --- | --- | --- |
| F1 | Confirmed operational defect; high/high | `testing/db.ts` loads `.env.local` into `process.env` and writes to `DATABASE_URL`; Playwright builds with inherited app/provider settings | A test can select a live app database/provider; an explicitly selected disposable URL can be overwritten. No live write was performed in this audit | Require `TEST_DATABASE_URL`, leave other process env alone, add `db:migrate:test`, and isolate the browser server's DB/secret/email settings. `environment.spec.ts`, fresh migration replay, and actual PostgreSQL/browser runs |
| F2 | Security hardening; medium/high | Original `auth.ts` enables unused OTP check/verification routes, accepts unsupported OTP purposes through its hook, and uses plain storage | Unneeded auth operations remain reachable; active OTPs are readable in a DB dump. No account-takeover exploit is asserted | `create-auth.ts` restricts routes/purpose, encrypts pending codes while retaining resend reuse, explicitly enables origin/CSRF checks, and enables supported adapter transactions. `create-auth.spec.ts`: real HTTP handlers + PostgreSQL, expiry/replay/attempts/origins, shared-instance rate limits, encryption |
| F3 | Confirmed hosted secret exposure path; medium/high | `email.ts` only forbids terminal delivery for `VERCEL_ENV=production` | A Preview deployment without a key would log addresses and usable codes. Preview is not currently provisioned | Fail closed on hosted Preview/Production; sanitize returned provider errors; preserve awaited sends and deliberate resends. `email.spec.ts` and negative/positive production-mode server starts with dummy settings, no real sends |
| F4 | Confirmed error-handling defect + availability hardening; medium/high | `db/client.ts` has no idle pool error listener and no connection/acquisition timeout | An idle-client error can throw an unhandled EventEmitter error; acquisition can wait indefinitely | Handle pool errors without error payloads and cap connection/acquisition waits at 10 seconds. `db/client.spec.ts` exercises the emitted error; pg 8.23.1 source confirms timeout coverage. This does not set a SQL statement timeout |
| F5 | Confirmed correctness defects + numeric hardening; medium/high for input/catalog failures, low/high for page arithmetic | `/seen/+page.server.ts` lets malformed multipart parsing and a missing movie reach uncaught failures; page-derived OFFSET can exceed JavaScript's exact integer range | Malformed bodies/missing IDs produce a 500; huge numeric pages can lose precision | Map only expected form-parsing TypeErrors to 400 and the exact movie FK error to 404 with no action log; propagate other errors; cap pages at the exact arithmetic limit. `seen.e2e.ts` reproduced the multipart 500 and now tests both deliberate failures and URL fallback. No speculative catalog-count query or performance index added |
| F6 | Confirmed state/recovery defects; medium/high | Sign-in input/email-switch remains editable during requests; home ignores returned sign-out errors; `SeenButton` releases saving only after refresh; stale `/action` URL keys precede the new action | Responses can describe different input, failure can appear successful or leave controls stuck, and a restored URL can invoke the wrong mutation | Lock pending inputs/controls, focus step transitions after `tick`, handle auth/refresh failures, release saving in `finally`, strip named-action keys in forms and remembered redirects. Browser tests cover delayed/aborted sends, sign-out retry, stale action URLs, and lost-response idempotency. Chromium component tests inject update rejection, confirm controls recover, and distinguish an acknowledged save from a redirect |
| F7 | Confirmed import defect + external-boundary hardening; medium/high | TMDB schemas accept arbitrary dates/ranges/paths; GETs lack timeout/bounded Retry-After; seed inserts empty/duplicate genre links | Invalid data fails late; provider requests can hang; legitimate genre-less batches and duplicate genre IDs can fail | Validate IDs/dates/ranges/CDN filenames, check returned movie ID, bound GET retries/timeouts, deduplicate links, and extract transactional `saveCatalog`. `schemas.spec.ts`, mocked `client.spec.ts`, real DB `save-catalog.spec.ts` cover empty batches, upsert/replacement, and complete rollback |
| F8 | Maintainability/verification; low/high | README omits setup/check/navigation details; CI omits browser journeys; critical auth/catalog behavior has little coverage | Important regressions can pass tooling | Document actual boundaries and safe setup; run browser journeys in CI; restrict CI token permissions and credential persistence; remove the unused scaffold root alias/module and unused `Movie` type. No framework conversion or dependency upgrade |
| F9 | Confirmed privacy defect; medium/high | Sign-in forms omit `method`; visual check before hydration issued `GET /sign-in?email=…` | Sensitive form fields can enter URL/history/access logs before client handlers attach | Use POST as the fallback on both forms. `sign-in.e2e.ts` submits with JavaScript disabled and asserts URL and request body. Functional sign-in still uses Better Auth's browser client; a no-JavaScript auth flow is not added |

## Exact versions and runtime

Resolved from the frozen `bun.lock` install and installed manifests, not package ranges. No dependency versions or lockfile entries changed during the original audit; the subsequent framework upgrade is recorded below.

| Packages/runtime | Resolved version |
| --- | --- |
| Node / Bun used for audit | 24.19.0 / 1.4.2 |
| `@sveltejs/kit` | 3.0.0-next.31 |
| `@sveltejs/adapter-vercel` | 7.0.0-next.9 |
| `svelte` / `@sveltejs/vite-plugin-svelte` / `vite` | 5.57.1 / 7.3.1 / 8.3.1 |
| `drizzle-orm` / `drizzle-kit` | 1.0.0-rc.4 / 1.0.0-rc.4 |
| `better-auth` / `@better-auth/drizzle-adapter` | 1.7.7 / 1.7.7 |
| `pg` / `@vercel/functions` | 8.23.1 / 3.9.9 |
| `resend` / `zod` | 6.31.0 / 4.6.5 |
| `typescript` / `svelte-check` | 6.0.3 / 4.7.6 |
| `vitest` / `@vitest/browser-playwright` / `vitest-browser-svelte` | 5.0.2 / 5.0.2 / 3.1.0 |
| `playwright` / `@playwright/test` | 1.63.0 / 1.63.0 |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 / 4.3.3 |
| `eslint` / `@eslint/js` / `typescript-eslint` | 10.11.0 / 10.0.1 / 8.71.0 |
| `eslint-plugin-svelte` / `eslint-config-prettier` / `globals` / `oxfmt` | 3.23.0 / 10.1.8 / 17.12.0 / 0.71.0 |
| `@types/node` / `@types/pg` | 24.19.0 / 8.23.1 |
| Disposable database / browser | PostgreSQL 18.6 / Chromium 153 (Playwright build 1243) |

`package.json` requires Node 24.x. The generated Vercel function config reports `nodejs24.x`, a Nodejs launcher, and adapter-controlled `experimentalResponseStreaming: true`. No Edge runtime is used. Vercel account settings/actual hosted runtime were not inspected.

Kit configuration lives in `vite.config.ts`, as required by this Kit 3 prerelease. It forces runes for handwritten components and leaves dependencies' compiler mode alone. Remote functions, fork preloads, and experimental Svelte async are not enabled; no experimental application API was added. The DB driver is `drizzle-orm/node-postgres` over a shared TCP `pg` pool, not Neon HTTP/WebSocket.

## Decisions and boundaries retained

- **Server owns identity and data.** The hook authenticates every app page/action/data request, and server mutations derive the user from `locals`. The layout returns only ID/email. Authentication endpoints are handled by the library's HTTP handler; bypassing it would omit rate limits/origin checks. App responses now explicitly use `private, no-store`. No client auth store, session cache, or shared user state was introduced.
- **Authorization is separate from sign-in.** Current seen-list reads/writes are scoped to the authenticated user. The action conflict comparison includes user/type/movie. A forged `userId` is ignored. No groups/roles/allowlist exist yet; open signup is an explicit product decision. Future group permissions still need implementation at their respective stages.
- **Keep the existing transaction design.** The action PK supplies duplicate-submit serialization; seen-list PKs and guarded insert/delete supply uniqueness; SQL increments avoid lost updates. Database regressions cover identical IDs, distinct concurrent IDs for the same/different movies, unchanged retries, conflicting payloads/users, and rollback. No preflight ownership query or in-memory lock was added. Schema constraints/indexes match current joins; none required a new migration at this catalog size.
- **Small interfaces at real boundaries.** `create-auth.ts` hides auth/library configuration behind DB/secret/sender inputs; `auth.ts` only wires runtime values. `save-catalog.ts` hides one PostgreSQL persistence transaction; the seed script only coordinates TMDB requests and reporting. These boundaries enable real DB/mock-provider tests without a dependency-injection framework. Existing route files, form actions, and UI structure remain.
- **Auth storage and delivery.** Better Auth 1.7.7 supports encrypted OTP storage with resend reuse; hashing would rotate reused codes. Defaults remain six digits, five-minute expiry, three attempts, seven-day sessions. Supported adapter transactions are enabled because pg provides interactive transactions. Library OTP consumption is atomic and concurrent verification/replay is tested. Neither factory instances nor Vercel processes own rate counters; both per-IP and per-address counters live in PostgreSQL.
- **Await email and avoid unsafe retries.** No background-task handler is configured; the installed library awaits the sender but catches/logs its errors and still reports success. The UI already explains missing email and offers resend. Resend's returned error category is logged without its recipient-bearing message. No retry was added for an uncertain send outcome. The user-requested resend is a new logical delivery, even if its OTP is reused; keying idempotency by email+code would suppress it. If a job retry mechanism is later added, it needs a send-operation ID. No webhooks/templates exist.
- **Validate before persistence.** TMDB fields are runtime-validated against the SQL/domain types. Empty dates/runtime/IMDb placeholders retain existing mapping behavior. Genre IDs are deduplicated; absent genres are legitimate. An empty discovery result fails before writes. GET retries remain limited to transient statuses; each attempt times out at 10 seconds and provider-controlled waits cap at 30 seconds. Transport/schema failures propagate. The Development seed rejects known hosted Preview/Production environments; it cannot prove that a manually supplied URL is a Development URL.
- **Query scope/performance.** Search uses parameterized, escaped `ILIKE`, user-scoped seen joins, indexed genre filtering, stable tie ordering, and `PAGE_SIZE + 1` rows without a count for pagination. Integration tests exercise literal `%`, `_`, backslash and injection-shaped input, decade boundaries, ordering, isolation, and page transitions. There was no measured slow query, so no speculative index, extra count, or arbitrary browsing cap was added. Full-catalog performance remains a stage 9 measurement.
- **Version-sensitive code stays documented.** `withVerifiedTls` retains full certificate verification for Neon URLs while leaving local non-TLS URLs intact. Raw `excluded.column` SQL contains schema-controlled identifiers only. PostgreSQL `xmax = 0` is retained solely for seed insert/update reporting and exercised against PostgreSQL 18.6. The generic seed worker's array assertion is guarded by an in-range synchronous index allocation. Test-only OTP decoding depends on 1.7.7's identifier/encrypted-value format and must be rechecked on auth upgrades.
- **Svelte for an Angular/React developer.** `$state` drives local pending/error UI; `$derived` calculates the current action from server props and URL state. `tick()` waits for a newly rendered input before moving keyboard focus. `use:enhance` posts the ordinary form action and refreshes server-loaded data; failures preserve the retry ID until a server response acknowledges it. Effects and new client/server state layers were unnecessary. Kit's reserved `/action` query keys must be removed before adding the current action; its enhanced redirect is a JSON envelope, while HTML requests get HTTP redirects.

## Sources and advisory assessment

Checked official prerelease docs, release notes, tagged source, and installed source/types together. Moving stable examples were not used to invent RC APIs.

| Area | Sources and relevant evidence |
| --- | --- |
| Kit 3 | [Migration guide](https://next.svelte.dev/docs/kit/migrating-to-sveltekit-3/llms.txt), [form actions](https://next.svelte.dev/docs/kit/form-actions/llms.txt), [env](https://next.svelte.dev/docs/kit/$app-env/llms.txt), [next.31 release](https://github.com/sveltejs/kit/releases/tag/%40sveltejs%2Fkit%403.0.0-next.31), [tagged action dispatch](https://github.com/sveltejs/kit/blob/%40sveltejs%2Fkit%403.0.0-next.31/packages/kit/src/runtime/server/page/actions.js). Installed config/types confirm env definitions, imports, adapter and experimental defaults; installed action dispatch confirms first named key and redirect negotiation |
| Better Auth | [OTP docs](https://www.better-auth.com/docs/plugins/email-otp), [rate limits](https://www.better-auth.com/docs/concepts/rate-limit), [security](https://www.better-auth.com/docs/reference/security), [v1.7.7 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.7), [tagged OTP source](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/plugins/email-otp/otp-token.ts), [context](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/better-auth/src/context/create-context.ts), [Drizzle adapter](https://github.com/better-auth/better-auth/blob/v1.7.7/packages/drizzle-adapter/src/drizzle-adapter.ts). Installed routes/defaults/adapter confirm encryption/reuse, consume-once, database rate counters/pruning, transaction option, test origin default, and awaited-but-caught email errors |
| Drizzle | [rc.4 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4), [tagged node-postgres session](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/node-postgres/session.ts), [migrator](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.ts). Installed types/source confirm relations-v2, interactive transactions, query error wrapping, Zod schemas, and new folder migration format. Drizzle's documentation site returned 403, so matching tagged/installed implementation supplied the API evidence |
| pg/Neon/Vercel | [pg 8.23.1 pool](https://github.com/brianc/node-postgres/blob/pg%408.23.1/packages/pg-pool/index.js), [Neon pooling](https://neon.com/docs/guides/serverless-connection-pooling), [Vercel connection pooling](https://vercel.com/guides/connection-pooling-with-functions). Source confirms acquisition/connection timeout and idle error behavior; guides support a shared registered pool. The hosted pool/lifecycle/TLS path still needs deployment verification |
| Resend | [Idempotency semantics](https://resend.com/docs/dashboard/emails/idempotency-keys), installed 6.31.0 types/implementation, plugin email reliability guidance. Provider tests mock delivery, returned errors, and transport uncertainty; no real provider behavior is claimed |
| TMDB | Official [details](https://developer.themoviedb.org/reference/movie-details), [release dates](https://developer.themoviedb.org/reference/movie-release-dates), and [rate-limit](https://developer.themoviedb.org/docs/rate-limiting) pages returned 403 in this environment. Validation was checked against existing fixtures/mapping, database column types, and known response fields; new real catalog refresh remains unverified |

`bun audit --json` returned `{}` for the resolved dependency set. That is an advisory-service result, not proof of an absence of vulnerabilities. Better Auth 1.7.7's release addresses [GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) and includes the PostgreSQL database-rate-limit concurrency fix. This app already resolves that version; Magic Link, social OAuth, and OAuth Proxy are not enabled. No applicable advisory requiring a dependency change was found in the reviewed set; no forced upgrade was performed.

Also reviewed the public advisory lists for [Kit](https://github.com/sveltejs/kit/security/advisories), [Svelte](https://github.com/sveltejs/svelte/security/advisories), and [Vite](https://github.com/vitejs/vite/security/advisories). Vite 8.3.1 exceeds the reviewed 8.x patch levels (latest affected range through 8.0.15); Svelte 5.57.1 exceeds the 5.55.7 SSR fixes. This app has no bound textarea/dynamic HTML. RC applicability was checked in source: next.31's content-negotiation regex matches the fixed [Kit 2.70.2 implementation](https://github.com/sveltejs/kit/blob/%40sveltejs%2Fkit%402.70.2/packages/kit/src/utils/http.js) for [GHSA-29g2-3rmr-qm68](https://github.com/sveltejs/kit/security/advisories/GHSA-29g2-3rmr-qm68), rather than assuming a 3.x version string excludes it. Remote functions/prerendering are disabled, redirect inputs are URL-normalized/encoded, and no ISR is configured; the Vercel adapter generates no ISR cache routes. Private response headers provide an additional explicit cache boundary.

## Final verification

Baseline checks above were already green; no pre-existing failing tests were hidden. During implementation, new auth-origin/header expectations and action-redirect assertions were corrected against installed library behavior, a stale-action regression exposed an actual bug, and the visual pre-hydration check exposed F9. No lint/check rule was disabled and no assertion was weakened to preserve a known defect. The browser runner refused to reuse the separately started production-settings preview, as intended; after stopping that owned process, the isolated test run passed.

| Check | Final result |
| --- | --- |
| Frozen install | Passed after script/root-alias changes; dependency set and lockfile unchanged |
| Fresh disposable migration run, then replay | Passed; four original migrations recorded once; all 11 application tables created |
| `bun run verify` | Passed: format/lint, zero type errors/warnings, 90 tests in 15 files (86 server/unit/database + 4 Chromium component tests) |
| `bun run test:e2e` | Passed: all 15 browser tests against a rebuilt production app with disposable DB and isolated email settings |
| `bun run build` with `VERCEL_ENV=production` and no email key | Passed. This build does not enforce the runtime email-module guard; a build is not proof of hosted email configuration |
| Final production-mode build with dummy email key | Passed after the last component change, with Vercel Node 24 output; no email or database mutation |
| Production-mode preview without key / with dummy key | Without key: expected server-start rejection naming `RESEND_API_KEY`. With dummy key: started and returned 200 for sign-in; no OTP/send request made |
| Svelte autofixer | Edited home, sign-in, SeenButton: zero issues/suggestions; final sign-in pass includes POST fallback |
| Local visual/browser journey | Passed: sign-in/redirect, catalog search, add, direct reload with retained filters/state, remove, home and sign-out; desktop and 390px screenshots inspected; no app console errors/overlays or horizontal overflow |
| Diff and secret-boundary review | Passed: reviewed handwritten changes and provider/test boundaries; `git diff --check` clean; fixture URLs/secrets/dummy key absent from client output; main/origin-main refs remain at the baseline |

Coverage is behavioral: real local PostgreSQL transactions/constraints and concurrent mutations, real auth HTTP handler/DB responses, Chromium components and full production-build browser journeys, and mocked external provider failures. Mock tests do not establish real Resend/TMDB delivery/availability. Neither a build nor these tests proves hosted end-to-end operation.

## Remaining questions and separate rollout work

1. **Encrypted OTP cutover:** no schema migration is needed, but pending plaintext OTPs from the prior code are incompatible with encrypted storage. Coordinate deployments sharing the verification table; do not run plaintext/encrypted auth versions concurrently. Allow the existing five-minute codes to expire during a quiet cutover and request fresh codes afterward. If overlapping deployments are required, design a separate compatible transition. Keep the existing auth secret to preserve sessions. No live verification rows were cleared or secrets rotated here.
2. **Email/domain and Preview:** the current `onboarding@resend.dev` sender still delivers only to the Resend account owner. Verify a domain and change the sender before a second person signs up, as the spec already requires. Configure an isolated Preview database/secret/email key and explicit Preview/custom host before using previews. This audit neither changes live settings nor broadens trusted hosts. Confirm HTTPS cookies, proxy IP handling, hosted pool lifecycle/TLS, migration history, and email delivery in the separately authorized live-site check.
3. **Unresolved RC driver edge (source confidence high; runtime consequence unverified):** Drizzle rc.4's node-postgres implementation executes `BEGIN` before its `try/finally` release block. If that initial statement rejects, the source does not explicitly release its borrowed client. Ordinary transaction rollback/concurrency are covered; initial-BEGIN transport failure and its pool-capacity consequence are not reproduced here. Do not claim the new pool timeout fixes this upstream edge. Verify/follow the tagged driver behavior and prefer a narrowly compatible upstream fix over monkey-patching the pool/ORM.
4. **Retention:** Better Auth 1.7.7 prunes expired database rate-limit rows; the old spec claim that these never prune was inaccurate. App-specific `sign_in_code_limits` retains one address per requester, and action logs grow by design for retry/undo semantics. Decide retention/pruning alongside stage 9 jobs, without removing required action history. No live cleanup was run.
5. **Product/runtime gaps:** signup stays open; no new allowlist, invite model, groups, watch sessions, jobs, or webhooks were invented. Bun remains unpinned in CI. Full catalog query performance, provider field compatibility for a new import, non-Chromium/screen-reader testing, and hosted Vercel/Neon/Resend behavior remain unverified. The schema/migration files were reviewed and applied locally, not compared to the deployed database. Stage 4's live-site check remains pending.

No new schema migration, production data change, deployment, or real email is part of this audit. The original audit was local; the user subsequently authorized publishing only the audit branch for review. Perform the OTP/email/Preview preparation where applicable, then authorize the normal migration/build/deployment workflow separately. The test migration command is for disposable databases only.

## Stable-framework follow-up (2026-10-03)

Upgraded the framework pair on the same isolated branch: `@sveltejs/kit` from `3.0.0-next.31` to exact `3.0.0`, and `@sveltejs/adapter-vercel` from `7.0.0-next.9` to exact `7.0.0`. No other resolved package versions changed. Bun also normalized the lockfile's two existing Better Auth root range declarations to match `package.json`; both resolved auth packages remain 1.7.7. Drizzle stays at 1.0.0-rc.4.

Reviewed the [stable announcement](https://svelte.dev/blog/sveltekit-3-is-here), [stable migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3/llms.txt), and matching [Kit changelog](https://github.com/sveltejs/kit/blob/%40sveltejs%2Fkit%403.0.0/packages/kit/CHANGELOG.md) / [adapter changelog](https://github.com/sveltejs/kit/blob/%40sveltejs%2Fadapter-vercel%407.0.0/packages/adapter-vercel/CHANGELOG.md). Compared the published prerelease/stable packages at the config, environment, form-action, cookie, client navigation, and public-type boundaries. Stable requirements are already met by Node 24.19.0, TypeScript 6.0.3, Svelte 5.57.1, Vite 8.3.1, and vite-plugin-svelte 7.3.1. The adapter's executable files are unchanged from next.9; its package version changed.

The application already uses Kit 3's Vite configuration, `#lib` imports, declared environment variables, and form/navigation APIs, so no application-code migration was needed. Remote functions and async Svelte remain disabled. README, contributor instructions, and the spec now distinguish stable Kit from RC Drizzle, link to stable docs, and use `bun outdated` for stable packages while retaining `outdated:next` for remaining prereleases.

The pre-upgrade type check passed with zero errors/warnings. Post-upgrade frozen installation, format/lint, and type checks passed; `bun run verify` passed all 90 tests in 15 files. `bun run test:e2e` rebuilt the app and passed all 15 Chromium journeys. The same four committed migrations were applied to a new disposable PostgreSQL 18.6 database on local port 55433; providers stayed mocked or terminal-only. `bun audit --json` returned `{}`. The existing optional-dependency and Vitest plugin-hook warnings remain; Playwright additionally reported inherited `NO_COLOR`/`FORCE_COLOR` precedence, without affecting results.

A separate production-mode `bun run build` also passed with the disposable database URL and a dummy Resend key, without delivery calls. The generated stable adapter function reports `nodejs24.x`, `launcherType: Nodejs`, and `experimentalResponseStreaming: true`, matching the original runtime. This validates build output, not hosted Vercel execution. The final documentation formatting and whitespace checks passed; only the framework pair, lockfile, version guidance, and update-checker comment changed.

The original rollout notes still apply, including encrypted OTP cutover and the pending stage 4 live-site check. This follow-up does not deploy, migrate a hosted database, send real email, or complete a product stage.

## Finalization and review publication (2026-10-03)

Confirmed findings F1–F9 are implemented; the remaining upstream driver question and separately authorized hosted checks remain explicit above. Added `docs/AUDIT_REVIEW_PROMPT.md` as an independent review handoff rather than prescribing a second implementation of the fixes.

This repository's Vercel Git integration normally deploys branch pushes, and its build command applies migrations. Added the supported, branch-specific `git.deploymentEnabled` setting to disable auto-deployment of `audit/correctness-security-2026-10-02` before publishing it. Other branches keep their existing behavior. Reviewed the [official configuration docs](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled) and [schema](https://openapi.vercel.sh/vercel.json); this changes repository configuration only, not live Vercel settings.

Finalization reran frozen installation, the four migrations on fresh disposable PostgreSQL 18.6, format/lint, type checks (zero errors/warnings), all 90 regression tests, all 15 production-build Chromium journeys, and a separate production-mode Node 24 build with dummy email settings. All passed; `bun audit --json` again returned `{}`. No runtime application code or migration history changed during finalization. GitHub CI runs on main and pull requests, so publishing a branch alone does not constitute a remote CI run.

Strict metavalidation of Vercel's entire published JSON schema failed on its unrelated queue-trigger definitions/draft declaration. Each of the three fields actually used (`$schema`, `git`, `buildCommand`) passed validation against its official property schema; exact branch-only disablement and the unchanged build command were also checked. No schema or application checks were weakened to hide a configuration error.

## Merge (2026-10-03)

A second review confirmed the findings and the stable upgrade against installed Better Auth 1.7.7 and SvelteKit 3.0.0 source. Before merging:

- `vercel.json`'s branch-specific rule was replaced with `{"main": true, "**": false}`: only `main` deploys, so PR branches never run hosted migrations while Preview is unprovisioned. (`**`, not `*`, because `*` doesn't match branch names containing `/`.)
- `docs/AUDIT_REVIEW_PROMPT.md` (a one-time handoff) was removed.
- `testDatabaseUrl()` no longer falls back to `.env.local`; `TEST_DATABASE_URL` comes only from the shell.
- `hooks.server.ts` notes that its `cache-control` header must be skipped for any future cacheable route, because Kit throws when a header is set twice.

Merging deploys Production with no new migrations. Codes sent before the deploy were stored in plain text and won't verify afterward; request a new code. The remaining questions above (Resend domain, Preview, Drizzle `BEGIN` edge, retention) carry forward as spec follow-ups.
