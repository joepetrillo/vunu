# Project Spec: Vunu

Full product spec and decision log. `AGENTS.md` holds the short, always-loaded rules; this file holds the details and the reasoning behind them. Update it when decisions change. Older implementation history lives in git and the PRs.

**Product identity:** Vunu, at [vunu.app](https://vunu.app) (`www.vunu.app` redirects there). Repository: [joepetrillo/vunu](https://github.com/joepetrillo/vunu) (originally `unseen`). The Vercel and Neon projects are named `vunu`; sign-in emails use `Vunu <hello@vunu.app>` on the verified Resend domain.

**Design principle for correctness:** prefer deriving state from a few stored facts over storing and syncing extra state. Simple but strong.

## 1. The product

**Problem:** finding something to watch as a group takes too long.

**Core idea:** the app finds movies that **nobody in the group has seen**. It does NOT judge whether people _want_ to watch them. Picking from the result is up to the group, outside the app.

**Principle:** users should do the least possible. One simple action at a time. No long lists to think through.

Movies only. US region only (release dates, age ratings). TV shows are a possible later addition.

### Users and groups

- Users sign up and can join multiple groups. A group allows up to 100 members, a hidden safety limit against a leaked invite; the UI treats groups as unlimited.
- **Invites (decided 2026-10-08, stage 5):** each group has **one invite**, shared either as a link (`vunu.app/join/K7QM2X`) or as the code inside it (`K7QM2X`), like Discord's invites. Codes are 6 characters from 31 unambiguous letters and digits (no 0/O, 1/I/L), about 890 million combinations, and typed input ignores case, spaces, and dashes. The code field accepts 0, O, 1, I, and L rather than silently refusing the keys (changed 2026-10-15 after Joe couldn't type 1 or I); a code with them gets the usual "That's not an active invite code." with no hint about which characters codes use (the owner's call: a hint was tried and removed the same day). Invites **never expire**: the owner's **Reset invite** replaces the code and the old one stops working. Because codes are short and permanent, every lookup (the "Join this group?" preview and the join itself) counts against a **per-user limit** (20 per 10 minutes). Any member can share the invite; only the owner can reset it. Revisit expiry if invites leak in practice.
- **Roles:** the creator is the group's **owner**. Only the owner can rename the group, reset the invite, remove members, and delete the group. Anyone can leave; when the owner leaves, the **longest-standing member** becomes owner; when the last member leaves, the group is deleted. No explicit ownership transfer in v1. The role is stored (not derived from join order) so explicit transfer can be added later.
- **Names (decided 2026-10-08):** each membership has a **nickname**, asked when you create or join a group and prefilled from your most recent one. Nicknames are unique within a group ignoring case, editable from the group's Settings screen, and only visible to that group. Email addresses are never shown to other members. Better Auth's `users.name` stays unused.
- Each user has ONE personal **seen list**, tied to the user, shared across all their groups.
- Each user's **Not seen** answers are remembered for **2 weeks** (decided 2026-10-13). An answer is a fact about you, so it counts in every group you're in. After 2 weeks it stops counting and the movie can be dealt to you again, because people watch movies elsewhere and never tell Vunu.
- A movie missing from someone's seen list means **unknown**, never "not seen". Only an explicit Not seen counts.

### How finding a movie works (decided 2026-10-13)

Stages 6–7 built **watch sessions** (a host, who's watching, End session); stage 8 replaced them with one deck per group. Nobody finishes a session in real life: once the group sees a movie they want, they watch it and forget the app. And a group already is the set of people, so a session was a group inside a group. Reasoning, alternatives, and simulations: the project files `stage-8/brainstorm.md`, `stage-8/algorithm.md` and `stage-8/explore/report.md`.

- **Nothing to start or end.** Open a group and tap **Find a movie** to get the deck. Everyone in the group counts toward every match. Close the app whenever; there's no host, no invite to accept, and no auto-close.
- Typical uses all work the same way: everyone on the couch on their own phones a few minutes before choosing, or one person opening it midday and the others answering later.
- **Joining or leaving the group** is the only membership there is. A new member counts at once, so matches wait for them (the "Waiting on" list shows their name, and the movies others cleared are dealt to them first). Someone who leaves stops counting, and matches recalculate.
- A group of one is allowed: every Not seen is a match.

### Answering

1. The deck deals one movie at a time, with two big buttons: **Seen** / **Not seen**, plus Undo. Swipe gestures are an optional extra, never the only input. No hearts, crosses, or like/dislike styling.
   - **Seen** adds the movie to your seen list. It's gone from everyone's deck and can never match in any of your groups. Others see this on their next refresh (a few seconds).
   - **Not seen** is remembered for 2 weeks (see above).
2. A movie is a **match** for a group when **every current member** has a Not seen for it from the last 2 weeks, nobody in the group has it on their seen list, and the group hasn't marked it watched. Matches are derived from answers only, never stored; preferences and catalog data decide only what gets dealt, so a catalog sync can't break a match.
3. Matches show up live while the deck is open. At **5 matches** each person is prompted to review the shortlist when the shared count reaches 5 during their visit (owner kept 5 on 2026-10-14; simulations suggested 3 would save about a third of the cards). It's not a hard stop: the first match is viewable as soon as it exists, and **Find more** keeps going.
4. **Waiting on {names}:** below the matches, movies that at least two members have answered Not seen, that nobody has seen, and that some members haven't answered yet, labeled with who hasn't. They're not matches and don't count toward the prompt. Why: everyone counts, so one person who isn't answering would otherwise block every match; this way the rest of the group still sees what's close, and the missing person gets those cards first when they open the app.
5. **We watched this** on a match removes it from that group's matches for good (an undoable group record, its own Watched screen). It doesn't touch anyone's seen list, because not every member may have watched it.
6. People answer at different times and pick up where they left off. Inactivity is never treated as Not seen.

### Deck order

Sort key, in order:

1. **Movies others in the group already said Not seen first**, most confirmations first ("finish what's started"). These come whatever your preferences are, because your one tap can finish a match.
2. Then **new movies that fit your preferences**, **best rated first**: TMDB's rating as a Bayesian (IMDb-style) weighted rating, `(votes × rating + 500 × 6.5) / (votes + 500)`, so a 9.0 from 250 votes doesn't jump ahead of an 8.4 from 30,000.
3. **Movie ID** as a stable tie-breaker.

Excluded: movies anyone in the group has seen, movies you answered Not seen in the last 2 weeks, the group's watched movies, unreleased movies (US), and movies under the vote floor of **1,000** (one named constant, `VOTE_COUNT_FLOOR`). Decided with the owner 2026-10-19, once the full catalog was in: the deck could deal 13,543 movies at 200 votes, 7,831 at 500, and 4,935 at 1,000. In the owner's trial the movies that felt obscure (niche anime, foreign comedies) all had under 1,000 votes, and even narrow preferences leave hundreds (R-rated live-action comedies: 527). The cost: a new release reaches the deck once it has 1,000 votes, usually a few weeks after it comes out. Old classics have far more votes, so the year preference, not the floor, is what keeps them out. Each sync still prints the counts at 100, 200, 500, and 1,000 votes.

Rules (decided 2026-10-12/13):

- **Never skip or bury a movie because it's popular and we guess people have seen it.** Every movie that fits is dealt eventually, in quality order. (Ordering by an estimated chance of being seen was simulated and ruled out by the owner.)
- **No cursors or page offsets.** Each fetch asks for "the top few eligible movies I haven't answered, excluding the ones already on my screen." Rankings shift as people answer, so a saved position would skip movies.
- **The visible card never changes under you; queued cards refresh freely** (decided 2026-10-11). Behind the visible card the browser keeps a small queue (about 5, posters preloaded) that every save response replaces. If someone else eliminates the visible card meanwhile, it stays, with no note (decided 2026-10-12).
- TMDB **popularity** and **trending** are different metrics; neither is used.
- **Validate the ordering** once real data exists: measure time to first match and answers needed to reach 5 matches.

### Preferences (decided 2026-10-13)

- **Runtime** (max minutes), **genre** (any of), **release year** (range). Movies missing runtime or a release year are excluded only when that preference is set.
- **Animation** (Any, Not animated, Only animated) and **age rating** (any of G, PG, PG-13, R, Not rated; none picked means all), added 2026-10-18 after the first full-catalog trial. Animation is TMDB's Animation genre, so it has its own field instead of a genre chip. R includes NC-17 (rare, and few people know it); Not rated covers TMDB's NR and movies with no US rating.
- **"In the mood for" is the first step of Find a movie** (decided 2026-10-18): the group page's Find a movie opens it, and the deck starts only after Show movies (or "Anything is fine"). On the deck, an "In the mood for" button above the card shows how many filters are set ("2 filters", or "Anything") and opens the same choices in a bottom sheet, so they can change at any time. It is one line on purpose (2026-10-19): a written summary of the picks got cut off with many picks and squeezed the poster on small phones. Why: in the trial the deck started on "Anything" and the small Change link went unnoticed.
- **Personal and per visit:** each person picks their own for tonight. They live only in the deck's URL query (`?maxRuntime=120&genreIds=35&animation=exclude&ratings=PG-13`), so they start fresh every time you come from the group page and nothing is stored. Nobody else sees or controls them. Why (2026-10-13): a mood belongs to one movie night, not to the person; remembered preferences would silently narrow next week's deck.
- **A preference only picks your new movies.** Movies the group has already started (others said Not seen) still reach you, so two people with different preferences still form matches. The screen says so in plain words, e.g. "In the mood for" with a line like "You'll also get movies your group has already started, so your answer can finish a match."
- The matches list shows **all** of the group's matches by weighted rating; while you have preferences set, the ones fitting them come first.
- Why (2026-10-13): with strict personal filters, a comedy fan and a horror fan would never be dealt the same movies, so no match could form. Shared group filters bring back the question of who controls them.

### States to show

- **You're caught up, waiting for others:** you've answered everything available to you; others still have movies to answer. "You're caught up. Waiting for Sam and Alex." By nickname.
- **No movies left:** nothing fits your preferences that you haven't answered. Suggest loosening them. Counts per preference ("312 more without the runtime limit") were deferred at stage 9 (2026-10-18): with the full catalog, running out should be rare; add them if real use shows people hit it.
- **Something failed:** distinguish "saving…" from "failed, retry", and a failed poll ("Can't reach Vunu. Trying again…").

### Fixing mistakes and managing data

- **Undo** is always visible while answering. It steps back through **your own answers from this group's deck**, newest first (per group: undo in one group never reaches back into another group's answers). Undoing restores your previous answer to that movie, whichever group it came from; a restored Not seen keeps its original time.
  - Undoing a Seen removes the seen entry only if **this action was the last one to confirm it**. If a later action (another group's deck, the Seen movies page) confirmed it again, the entry stays.
  - Undoing a Not seen withdraws it, so the movie may leave the matches.
  - The undone movie comes back as the visible card, so it can be answered again.
- **"Actually, I've seen this"** on a match: recorded as a Seen answer that replaces your Not seen, on your undo stack like any other answer.
- **My Seen Movies** page: search by title, filter (genre, year, etc.), remove entries.
- **Removing a seen entry lets your earlier Not seen answers count again** (if still within 2 weeks). They were your own answers, so if the Seen was a mistake, they're correct. (Deliberate rule; no extra invalidation logic.)
- All seen-list changes (answers, undo, corrections, page edits) go through **one server module**.
- Always show year and poster (remakes share titles).
- **Where to watch:** an external link only, to TMDB's watch page (`https://www.themoviedb.org/movie/{id}/watch?locale=US`), with no promise the movie is actually available. TMDB asks apps to link there because it holds the provider deep links. Showing provider names in our own UI was considered and dropped (2026-10-11): TMDB's provider data needs JustWatch attribution and frequent refreshes.

### Scope

**v1:** auth, groups, the group deck, Seen/Not seen answering with Not seen remembered for 2 weeks, personal preferences (runtime, genre, year, animation, age rating), best-rated deck order with finish-what's-started, live matches with the 5-match prompt and Find more, Waiting on {names}, We watched this, undo, "Actually, I've seen this", My Seen Movies page, the deck states, unreleased excluded, where-to-watch link.

**Later:** splitting new movies between members ("scouting": each person gets a different next-best new movie when nothing is half-finished; simulated to save 25–40% of cards for 4+ people answering at once; add if real nights feel slow), re-checking an expired Not seen with one tap instead of re-dealing it, Letterboxd CSV import, "allow 1 person who's seen it" leniency for big groups (off by default; simulations found it slows strict matches), actor/trending preferences, IMDb ratings and vote counts for the deck order and vote floor (IMDb's free daily ratings file, personal non-commercial use, matched on the stored `imdb_id`; owner, 2026-10-19: TMDB for now, maybe IMDb later), Rotten Tomatoes/Metacritic scores via OMDb (paid), verified streaming availability, real-time updates, accent-insensitive seen-list search (`unaccent`: "amelie" finding "Amélie"), TV shows. Simulated and dropped (2026-10-13): an onboarding "tap the posters you've seen" grid, a third "Not for me" answer, and quietly boosting other members' preferences in your deck.

## 2. Movie data: TMDB with our own catalog copy

- Source: **TMDB** (The Movie Database), a free community API. Its vote counts are smaller than IMDb's, but its relative order is good enough for "how well-known" ordering and a basic rating filter.
- TMDB cannot exclude our users' seen movies, so filtering happens on our side.
- **Chosen approach: keep our own copy of the catalog in Postgres.** TMDB is never called during a user session.
- **Sync (decided 2026-10-18, stage 9):** one command, `bun run catalog:sync` (`scripts/sync-catalog.ts`, logic in `#lib/server/tmdb/sync-catalog.ts`), both loads the full catalog the first time and keeps it fresh. Each run:
  1. **Discovers** every movie with at least **50** TMDB votes (`CATALOG_MIN_VOTES`): 36,825 movies at the first full load (each run prints the real count). The deck deals only those above `VOTE_COUNT_FLOOR`, so that floor can move without a resync, and seen-list search finds less-known movies too. Discover stops at 500 pages per query, so the date range (1870 to two years ahead) is split in half until each part fits; the request that measured a part is reused as its first page. Results are sorted by original title, which rarely changes, so pages stay stable while they're read. Discover results carry each movie's vote count and rating, so this pass refreshes every movie's votes for a few hundred requests. New movies are saved straight away **without details**; with no US release date they're never dealt.
  2. **Fetches details** (runtime, genres, US release dates and certification, IMDb ID, poster) for movies that have none yet, plus the stalest seventh of the catalog (`REFRESH_SHARE`) not detailed in the last day, so with a run every 2 days each movie's details are at most about 2 weeks old. TMDB's changes feed was considered and not used: it needs the last run's date and a fallback beyond its 14-day window, and runtime and release dates rarely change.
  - **Resumable without a progress table:** `movies.details_synced_at` is the progress. The to-do list is a query ("no details yet, or the stalest"), so a run that dies part-way leaves the next run exactly what's left. Details are saved 100 movies per transaction, so an interruption loses at most one batch and live requests never wait on a long lock.
  - **Failures:** a movie TMDB no longer has (404) keeps its row (people may have seen it) and is marked checked. A movie whose details fail validation or keep erroring is skipped; the run continues, then fails at the end so the alert fires, and the movie is retried first next time. 20 failures stop the run (a bad token or an outage). A run that discovers nothing fails instead of looking successful. The client starts at most 35 requests a second (TMDB's limit is in the 40s per IP), so a long run doesn't depend on 429 retries; a full load is about 32,000 requests, roughly 15 minutes.
  - **One at a time:** the run holds a Postgres advisory lock on a dedicated connection; a second run against the same database exits at once. That needs the direct (unpooled) URL, which the script insists on.
  - **Never from a laptop to Production:** the script refuses Production's endpoint unless `GITHUB_ACTIONS` is `true` (`assertCatalogSyncTarget` in `production-guard.ts`). Locally it fills the Development database from `.env.local`; Preview databases are copies of Production, so they get the full catalog automatically.
- **Schedule and alerts (GitHub Actions, `.github/workflows/catalog-sync.yml`):** every 2 days at 09:23 UTC (`23 9 */2 * *`; the owner chose 48 hours over daily on 2026-10-18) and on demand. GitHub cron can start late or be dropped, and in a public repository it is switched off after 60 days without activity, so a run that never starts would be silent. The workflow pings **Healthchecks.io** at start, success, and failure (secret `HEALTHCHECKS_PING_URL`); Healthchecks emails the owner on a failure or when no success arrives on schedule. GitHub's own failure emails go to whoever last edited the cron line. A `force_failure` input fails a manual run on purpose to test the alert.
- **Database access:** the workflow connects as `catalog_sync`, a Postgres role that can only read and write `movies`, `genres`, and `movie_genres` (created with SQL in Neon's editor on `production`; roles made in Neon's console UI get broad rights). A leaked secret couldn't touch accounts, groups, or answers. A future table the sync writes needs its own `GRANT`. Retention for the limit tables, `actions`, and expired `not_seen_movies` stays out of this job (decided 2026-10-18; revisit after launch), which keeps the role narrow.
- Store: title, year, US release date, runtime, genres, US certification, rating average, vote count, poster path, IMDb ID, last-synced time (`synced_at`, from any pass) and last-details time (`details_synced_at`, null until details arrive).
- Posters load directly from TMDB's image CDN; store only the path.
- **Size check (stage 9):** with 30,000 synthetic movies and four members with 1,000 seen and 300 Not seen each, dealing cards took 15–26 ms, counting matches 2 ms, and seen-list title search (plain `ILIKE`) 12 ms. No extra index needed; if title search gets slow, a `pg_trgm` index fixes it.
- **Before launch:** read TMDB's API terms (attribution, data storage rules).
- Rejected: fetching from TMDB live and filtering page by page. Too many API calls, slow for users with big seen lists.

## 3. Data model

**Naming:** tables are plural nouns in snake_case (`seen_movies`, `group_members`); Better Auth's `usePlural` keeps its tables in line (`user` would also be a reserved word in Postgres). `sessions` is Better Auth's login-session table.

- **users** (+ `seen_version` counter, bumped by seen-list changes and answers), plus Better Auth's other tables: **sessions** (login sessions), **accounts**, **verifications** (sign-in codes), **rate_limits**, and our **sign_in_code_limits** (per-email limit).
- **groups** (ID generated by the browser with the create action, so a retried create lands on the same group; name; `invite_code`, unique; `revision` counter for polling, bumped by membership changes (join, leave, removal, nickname) and We watched this), **group_members** (group, user, role owner/member, nickname, joined_at; primary key (group, user); unique (group, lower(nickname)); a partial unique index allows one owner per group), **invite_lookup_limits** (per-user window and count).
- **movies** (catalog copy, section 2), **genres**, **movie_genres**.
- **seen_movies** (user, movie, created_at, `last_confirmed_by_action`), primary key (user, movie), which also serves lookups by user. `last_confirmed_by_action` has no foreign key, like the log's other IDs; only undo reads it.
- **not_seen_movies** (user, movie, answered_at, `last_confirmed_by_action`), primary key (user, movie). A row counts while `answered_at` is within 2 weeks; expiry is computed in queries, so no job deletes rows. Answering Seen deletes your row for that movie; answering Not seen again refreshes `answered_at`.
- **group_watched_movies** (group, movie, marked_by, created_at), primary key (group, movie): "We watched this". `marked_by` is nullable (`ON DELETE SET NULL`), so the record outlives the account that made it; deleting the group deletes its rows.
- **actions** — action log for idempotency and undo: action ID (client-generated, primary key), user, type, created_at, and typed nullable input columns: `movie_id`, `group_id`, `member_id`, `group_name`, `nickname`, plus `undone_by_action_id` (set on an answer when an undo reverses it). Reusing an action ID with a different payload fails; the payload is compared column by column rather than through a stored hash. The group columns have no foreign keys, so the log outlives a deleted group (a retried delete is still a duplicate). Types: `seen_list_add`/`remove`, the `group_…` changes, and the deck's `answer_seen`, `answer_not_seen`, `answer_undo`, `group_mark_watched`, `group_unmark_watched` (`group_id` is the deck the answer came from). The undo stack is your `answer_*` actions in that group that aren't undone, read through an index on (user_id, group_id, created_at) `WHERE group_id IS NOT NULL` (Postgres can't use an enum value in the migration that adds it, so the index can't filter on the new types).
- **No preferences table:** preferences are per visit and live in the deck's URL (section 1), validated with Zod in the page's `load`: `maxRuntime`, `minYear`, `maxYear`, repeated `genreIds`, `animation` (`exclude` or `only`), and repeated `ratings` (`G`, `PG`, `PG-13`, `R`, `NR`).
- **Matches are derived**, never stored (section 1).

**Retired:** stages 6–7's watch-session tables, the log's watch-session columns, and the `watch_*` action types were dropped after stage 8 shipped, in two deploys: a column can only go once the deployment still serving has stopped reading it. Their answers were not carried over.

## 4. Correctness rules

- **Authorization:** each operation checks the permission it needs. Answering, undo, We watched this, and reading a deck or its matches require membership in that group. Seen-list edits only need to be your own list. Viewing or changing a group requires membership, and a non-member gets the same "not found" as for a missing group, so group IDs reveal nothing; owner actions require being owner; joining requires the group's current invite code. The acting user always comes from the login session, never from request data.
- **Idempotency:** every mutation carries a client-generated **action ID**. Retrying a request that already succeeded returns the stored result and changes nothing.
  - Server: `runAction` (`#lib/server/actions.ts`) logs the action and applies the change in one transaction, returning `applied`, `duplicate` (a retry; nothing changes), or `conflict` (the ID was used for a different action). A failed change rolls back its log entry, so only successful actions are recorded and a retry of a failure runs normally. A double submit waits on the primary key and is applied once.
  - Browser: one action ID per intended change, kept until the server answers. After an error with an unknown outcome (dropped connection, server error), trying again resends the same ID. Seen-list edits have no result worth storing (the page reloads its data); a `result` column comes with the first action that needs one.
- **Transactions:** each mutation (answer, undo, membership change, We watched this, seen-list edit) runs in one transaction that bumps **every counter it affects**: `users.seen_version` for anything about a person (answers, seen-list edits), `groups.revision` for anything about the group.
- **Stale requests:** answers carry their group and movie ID. A request for a group you've left is rejected (`not_found`); a missing movie is rejected (`movie_not_found`). A late Not seen on a movie someone has seen is recorded but can't match; a Seen always updates the seen list.
- **Driver:** one TCP connection pool (see section 5b); transactions work over it directly.
- **Required tests:** matches across members' answers, 2-week expiry at the boundary, different preferences still forming matches, joining and leaving the group mid-deck, the Waiting on list, We watched this and its undo, undo across groups, undo conflicts (a Seen confirmed again elsewhere), simultaneous answers, retries, an action ID reused with different input, and stale poll responses.

## 5. Updates between users: polling, designed to be swappable

- v1 uses **polling**, not WebSockets. Small groups, a few seconds of delay is fine, and Vercel serverless can't hold WebSocket connections. WebSockets would still need all of the consistency logic below (phones drop connections), plus a separate service and channel auth. Revisit only if real use shows the delay bothers people.
- **Change detection with a fingerprint:** the poll compares a fingerprint of the group's `revision`, each member's answer counter (section 3), and how many of the members' Not seen answers still count. Answers are facts about a person, so one answer updates every group that person is in, with no cross-group writes or locking. A Not seen expires with no write at all, so that count is what notices an expiry: it drops (added 2026-10-15 after a Codex review on PR #5; before, an open tab kept an expired match until something else changed).
- When the fingerprint changed, the server returns full state and the new fingerprint from **one consistent read**.
- The client applies only the response to its **latest** request. Polls never overlap.
- **Coordinate polling with saves:** while a save (or undo) is in flight, pause polling and discard any refresh response that started before the save, so it can't overwrite the save's result. Refresh once the save completes. **Numbers (decided 2026-10-12):** every 2.5 s while the deck is open and visible, multiplying by 1.5 per unchanged reply up to 10 s, back to 2.5 s after any change or your own save; paused in the background; immediately on focus, visibility, or reconnect; a failed poll doubles the wait (up to 10 s) and shows "Can't reach Vunu".
- An unchanged fingerprint gets a tiny "no change" response. The fingerprint is a 16-character SHA-256 digest of the group's revision, each member's `user:seen_version`, and the members' count of still-counting Not seens; the full state is the next cards (skipping the cards on screen), a match **count** (not the list; decided 2026-10-12), whether you can undo, and who you're waiting on. Reads use one repeatable-read, read-only transaction, so the fingerprint describes exactly the state returned with it.
- A user's own answer response returns fresh state; polling only catches other people's changes.
- **Swappable boundaries:**
  - Server: `notifyGroupChanged(tx, groupId)` in `groups.ts` bumps the group's revision; `bumpSeenVersion(tx, userId)` in `seen-list.ts` bumps a person's counter (answers and seen-list edits). The poll is `GET /groups/<id>/find/poll?since=…&exclude=…` plus the preferences (`pollGroupDeck` in `group-deck.ts`: unchanged, the deck's state, or ended once you've left); answers reply with the same state (`readDeckState`).
  - Client: `subscribeToDeck(pollUrl, { fingerprint, query, onChange })` in `#lib/deck-updates.ts`, which reports only changes; `hold()` pauses it for a save and returns the release, and `saw(fingerprint)` records a save reply's state. The deck (`groups/[groupId]/find/deck.svelte.ts`) is its only user.
  - Switching to a real-time service (Ably/Pusher/PartyKit, or self-hosted WebSockets + Redis pub/sub) means rewriting only these boundaries; the fingerprint logic stays as the safety net.
- Only the deck polls. Other group screens (members, matches, settings) show what was true when they loaded.

## 5b. Database connections

Server code runs as Node.js functions on Vercel **Fluid compute**: one warm instance serves many requests at once, so it can hold and reuse connections like a small traditional server. Following Neon's and Vercel's guidance for that setup:

- **Driver:** `pg` (node-postgres) with Drizzle's `node-postgres` driver. Normal TCP connections, so interactive transactions work. No HTTP or WebSocket driver needed.
- **One pool per instance, at module level** (`src/lib/server/db/`), `max` 1–2 connections. Never create a client inside a request handler. Idle-client errors are handled, and connecting or acquiring a connection gives up after 10 seconds.
- **`DATABASE_URL` = Neon's pooled connection string** (hostname contains `-pooler`). Neon's PgBouncer multiplexes many client connections onto a few real Postgres connections, which prevents the "connection storm" when instances scale up.
- **`DATABASE_URL_UNPOOLED` = the direct (non-pooler) string**, used only by `drizzle-kit` for migrations, which need a real session. (Named by Neon's Vercel integration, which sets both variables on Vercel for every environment.)
- **`attachDatabasePool(pool)`** from `@vercel/functions` closes idle connections before Vercel suspends an instance, so they don't leak.
- **Region:** the Neon project is in AWS `us-east-1`, next to Vercel's default function region `iad1`.
- **Provisioning:** a Neon project created in Neon's console (Free plan, Neon's managed auth off because we use Better Auth), linked to Vercel through Neon's **Neon-Managed** integration (Vercel "Connectable Accounts", configured in Neon Console → Integrations; billing stays with Neon). It doesn't appear under Vercel's Storage tab. It created the `vercel-dev` branch for Development and sets Production/Development variables.
- **Databases per environment:** Vercel's Production and Development environments point at separate Neon endpoints, so local work never touches production data. **Preview (since 2026-10-08):** the Neon integration's preview branching gives every Preview deployment its own database branch, `preview/<git-branch>`, copied from `production` (the integration's default; real accounts are copied, inside our own Neon project). The connection strings are injected per deployment and aren't visible in Vercel's settings. The build migrates that branch, so a PR's migrations are tested on a copy of real data before they reach Production. Preview also has its own `BETTER_AUTH_SECRET` and reuses Production's `RESEND_API_KEY` (chosen for simplicity; a separate sending-only key is the more isolated option). Auth trusts the deployment's exact hostnames (`VERCEL_URL`, `VERCEL_BRANCH_URL`). Previews sit behind Vercel Authentication, so viewers need access to the Vercel project.
  - **Guard:** a Preview build migrates whatever database it is given, so `src/lib/server/db/production-guard.ts` compares the connection's Neon endpoint with Production's (`ep-aged-sun-b81mzqrl`; an endpoint ID, not a secret) and fails a Preview migration or server start that targets it. Update the ID if Production's endpoint is ever replaced.
  - **Dashboard env-var bug (2026-10-09):** Vercel's dashboard can't add variables to this project ("Failed to verify the project's public environment variable prefix"). It looks for `svelte.config.js` to find the public prefix, but Kit 3 rejects that file (a hard error at startup in every command) and has no public-prefix option at all (public variables are declared with `defineEnvVars`). Vercel support's suggested empty `svelte.config.js` therefore breaks every build: **never add it**. Add variables with `vercel env add <name> <environment> --sensitive` or the REST API until Vercel fixes the check. Reported: [sveltejs/kit#17393](https://github.com/sveltejs/kit/issues/17393) (adapter-vercel lives there) and Vercel support.
  - **Cleanup:** the integration's **Automatically delete obsolete Neon branches** setting (Neon Console → Integrations → Vercel → Manage) deletes `preview/<branch>` once its Git branch is gone, checked at the next preview deployment. GitHub's **Automatically delete head branches** setting removes merged branches, which completes the loop. Leftovers can be deleted in the same Neon screen. Don't rename Git or preview branches; matching is by name. Source: [Neon-Managed integration](https://neon.com/docs/guides/neon-managed-vercel-integration#branch-cleanup).
- **Local setup:** Vercel holds every variable (including `TMDB_READ_ACCESS_TOKEN`, a Development-only Secret: the deployed app never calls TMDB, and Production Secrets can't be pulled; the Production sync's copy is a GitHub repository secret); `vercel env pull` writes the Development values to `.env.local`, the only local env file. drizzle-kit only auto-loads `.env`, so `drizzle.config.ts` loads `.env.local` explicitly; without that, migrations went to whatever `.env` held (this happened once, Sep 30 2026). No local command targets Production: it changes only through deploy-time migrations and the catalog sync workflow (GitHub Actions, values from repository secrets; the script refuses Production anywhere else, section 2). A local Production seed script existed briefly and was removed: a laptop-to-Production path is the risk that caused the Sep 30 migration, and `vercel env run -e production` silently overlays `.env.local`.
- **Migrations:** `drizzle-kit generate` writes SQL files to `drizzle/` (committed); `drizzle-kit migrate` applies them (locally: dev database). Production migrates during every Vercel deploy (`vercel.json` build command: `db:migrate && build`). The old deployment keeps serving until the new one is ready, so migrations must be backward compatible; a failed migration fails the deploy and the old version keeps running. Never `drizzle-kit push`.
- **TLS:** Neon's URLs say `sslmode=require`; `withVerifiedTls` (db/url.ts) rewrites it to `verify-full` so certificate checks survive pg v9, where `require` stops verifying. URLs without `sslmode=require` (CI's local Postgres, which has no TLS) are left alone.
- **Tests:** database tests (Vitest and Playwright) require an explicitly disposable `TEST_DATABASE_URL`; they never fall back to the app's `DATABASE_URL`. `bun run db:migrate:test` applies committed migrations to that database without loading Development migration settings. Each test creates unique users/movies/genres and deletes them afterwards. Playwright builds with the test database, a fixture auth secret, and terminal-only email; provider tests use mocks. CI supplies a throwaway Postgres 18 service container (Neon runs 18), with migrations applied first (`.github/workflows/ci.yml`). Shared helpers: `#lib/server/testing/`; setup: README.
- Rejected: Neon's HTTP driver (can't run interactive transactions; built for one-request-per-instance platforms) and its WebSocket driver (for runtimes without TCP, like edge; we don't use edge, and Kit 3 dropped edge support on Vercel).
- Sources: [Neon serverless connection pooling](https://neon.com/docs/guides/serverless-connection-pooling), [Vercel Fluid compute](https://vercel.com/docs/fluid-compute).

## 6. Tech stack (decided)

| Area | Choice | Why |
| --- | --- | --- |
| Framework | Svelte 5 + SvelteKit 3 (stable, pinned) with the Vercel adapter | Learning goal. Kit 3 adopted before stable (Sep 2026) |
| Language | TypeScript (strict) |  |
| Styling | Tailwind CSS |  |
| Components | shadcn-svelte (built on Bits UI), **Maia** style, Bits UI directly for custom pieces; Lucide icons | Headless, accessible, owned code. Maia (soft, rounded, generous spacing) chosen for a mobile-first feel (2026-10-11): default shadcn components with big tap targets, not imitations of iOS-specific patterns. Lucide draws icons in the server's HTML; Hugeicons, used before, drew them only after hydration, so every icon flashed in (switched 2026-10-20) |
| Database | Neon Postgres | Relational data; the deck is a SQL exclusion query |
| DB library | Drizzle v1 release candidate, pinned (`node-postgres` driver over Neon's pooler; see section 5b) | Reads like SQL, so it teaches what's happening. v1 chosen so the relations/query API learned is the one that stays; Better Auth supports it via its relations-v2 adapter |
| Validation | Zod 4 | All external input (TMDB, env vars, forms, URL params); types come from `z.infer`. Chosen over Valibot/ArkType (Sep 2026) for familiarity and ecosystem: Better Auth already depends on it, Kit's `defineEnvVars` accepts it (Standard Schema) |
| Auth | Better Auth, **email one-time code only** (email OTP plugin), encrypted OTP storage with resend reuse | Works across devices (read email on laptop, sign in on phone), unlike magic links. No passwords. Encryption keeps pending codes out of database dumps while preserving the same code on resend; unused verification/password/email-change routes are disabled. Better Auth logs a failed send and still reports success (against timing attacks), so the code step says to check spam and offers "send it again" |
| Auth rate limits | Better Auth's per-IP limits with **database storage**, loosened (10 code emails per 10 min, 10 sign-in attempts per min), plus **our own per-email limit** (3 code emails per 10 min per address, `sign_in_code_limits`, enforced in a Better Auth `before` hook) | In-memory limits don't work across serverless instances. People in one room share an IP (Wi-Fi NAT, carrier NAT, one IPv6 /64), so per-IP limits must leave room for a group; the per-email limit is what protects an inbox, and a refused request never replaces the pending code. Guessing is stopped by each code's 3-attempt limit. Sessions stay at Better Auth's default: 7 days, extended on use |
| Login email | **Resend** on hosted Production and Preview; locally, without a key, the code is printed to the terminal | Hosted environments fail server initialization without a key. Sign-up is open to any email; request/code limits constrain abuse |
| Hosting | Vercel | Near-zero config for SvelteKit |
| Catalog sync | GitHub Actions scheduled workflow, every 2 days | Free, no serverless time limits; Production's database URL lives only in a repository secret |
| Tests | Vitest (unit/integration), Playwright (end-to-end) | Database tests run against real Postgres (section 5b): transactions, locks, and constraints are what they test |
| Lint/format | ESLint (eslint-plugin-svelte + typescript-eslint strict type-checked) + oxfmt + svelte-check | See section 8 |
| Package manager | Bun |  |

Not needed for v1: WebSockets or real-time services, Redis, job queues (BullMQ), Kafka, a separate caching layer.

**Scrolling is left to SvelteKit (decided 2026-10-20).** On a reload Kit 3 restores the scroll position only once its JavaScript loads, so a scrolled page paints at the top and then jumps. An inline `app.html` script could restore it before the first paint, but we accept the jump until Kit fixes it (Kit 2 handed reloads to the browser; sveltejs/kit#17244 dropped that).

## 7. Build order

Design the schema with the whole spec in mind, but build features in stages. Each stage is a clean stopping point: when its "Done when" checks pass, nothing is half-built and nothing needs remembering.

**Every stage ends the same way:** lint, svelte-check, and tests pass; changes committed and deployed to Vercel; the Progress list below updated with the stage status and any follow-ups.

Done (details in Progress): 1. Setup and deploy. 2. Database and small catalog. 3. Auth. 4. Seen list. 5. Groups and invites. 6. Solo session. 7. Group sessions. 8. Group deck (replaced sessions). 9. Full catalog sync.

10. **Launch.** TMDB attribution and terms check, ordering metrics (section 1, Deck order). Revisit: branch protection on `main` requiring the CI `verify` check (until then changes reach `main` by direct push or PR), and moving CI off the pinned `ubuntu-24.04` runner. Already in place: the production email provider (Resend on `vunu.app`) and a styled error page (`+error.svelte`). _Done when:_ you and your brother use it for a real movie night.

### Current state

_As of 2026-10-20. `main` holds stages 1–9, the deck filters, and PRs up to [#16](https://github.com/joepetrillo/vunu/pull/16), all deployed to Production._

Live at [vunu.app](https://vunu.app): email-code sign-in, the seen list, groups with invites by link or code, and the group deck (section 1). The catalog is the full TMDB sync: 36,825 movies with 50+ votes, 4,935 of them dealable at the 1,000-vote floor.

**Next: stage 10, launch** (build order above).

**Still open from stage 8:** the Production smoke check (one two-account match on `vunu.app`). Stage 8 was verified on its Preview, not yet on Production.

- **Deployments:** `main` deploys Production; every other pushed branch gets a Vercel Preview with its own Neon database branch (section 5b). Previews need Vercel login (or a share link). Add Vercel env vars with the CLI or REST API, not the dashboard (section 5b). Vercel once didn't start a deploy for a merge commit (PR #12); start it by hand if that happens.
- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`: frozen install, lint, svelte-check, Vitest (unit, component, database), migrations, and Playwright journeys against Postgres 18. **Catalog sync** (`.github/workflows/catalog-sync.yml`) runs every 2 days and on demand.
- **Workflow:** changes reach `main` through PRs: a Codex review, its findings fixed, CI green, then merge.

**Deferred work:**

- A local disposable Postgres for this Mac, and safe Development reset tooling (empty the `vercel-dev` branch's `public` and `drizzle` schemas, then `db:migrate` and `catalog:sync`). Avoid Neon's "reset from parent", which copies Production's rows.
- Drizzle: rc.4's node-postgres transaction runs `BEGIN` before its `try/finally`, so a failed `BEGIN` may not release its pool connection. Recheck on the next Drizzle upgrade; prefer an upstream fix over patching the pool.
- Bun pinning (CI and local).
- Account deletion: it must hand group ownership on (today a cascade would remove memberships without promoting anyone).
- Retention for `sign_in_code_limits`, `invite_lookup_limits`, `actions`, and expired `not_seen_movies` rows (kept out of the sync, section 2; revisit after launch). Better Auth already prunes `rate_limits`.
- Broader browser and accessibility coverage (tests run in Chromium only).

### Progress

<!-- Update at the end of each stage: stage number, status, date, PR, and any decision not recorded above. -->

- **Stage 1 — done 2026-09-30.** Scaffold (`sv create`, Bun, Tailwind, Drizzle, Vitest, Playwright, Vercel adapter, ESLint, oxfmt), strict type checks, CI, `AGENTS.md`, Svelte AI tools. Node pinned to `24.x` via `engines`, read by CI and Vercel.
- **Stage 2 — done 2026-09-30.** Neon, the `pg` pool and Drizzle v1, the catalog tables, Zod for external input, and a 300-movie seed (replaced by stage 9's sync).
- **Stage 3 — done 2026-09-30.** Better Auth email codes. All sign-in routing lives in `hooks.server.ts`; pages only call `refreshAll()`. `redirectTo` is parsed as a URL against our origin (a string check let `/\t/evil.com` through, which browsers treat as `//evil.com`).
- **Audit — done 2026-10-03 ([PR #1](https://github.com/joepetrillo/vunu/pull/1)).** Disposable test databases (`TEST_DATABASE_URL`), encrypted OTP storage and a restricted auth surface, hosted email that fails closed without a key, pool error and timeout handling, stale-action URL protection, TMDB validation and timeouts, browser journeys in CI. Followed by SvelteKit 3.0.0 stable and the Vunu rebrand (2026-10-05). The audit report was deleted 2026-10-20 (in git history); its open items are in Deferred work.
- **Stage 4 — done 2026-10-08.** `runAction`, `seen-list.ts`, and the Seen movies page (tabs, search, filters, and pages in the URL).
- **Stage 5 — done 2026-10-10 ([PR #2](https://github.com/joepetrillo/vunu/pull/2)).** Groups, owner and members, one invite per group, nicknames, `ActionForm`; Preview deployments with their own databases (section 5b).
- **Stage 6 — done 2026-10-12 ([PR #3](https://github.com/joepetrillo/vunu/pull/3)).** shadcn-svelte (Maia), `Page.svelte` and `ListGroup.svelte`; solo watch sessions (replaced in stage 8).
- **Stage 7 — done 2026-10-12 ([PR #4](https://github.com/joepetrillo/vunu/pull/4)).** Group watch sessions and polling (section 5; replaced in stage 8, the polling kept).
- **Stage 8 — done 2026-10-15 ([PR #5](https://github.com/joepetrillo/vunu/pull/5)).** The group deck replaced watch sessions (section 1); a hub group page with screens under it, `CodeInput`, the theme toggle, Geist fonts, `ConfirmDialog`, a styled error page, and a worst-case data pass (rules in AGENTS.md). PRs [#6](https://github.com/joepetrillo/vunu/pull/6)–[#9](https://github.com/joepetrillo/vunu/pull/9) dropped the session tables and columns, made the fingerprint notice expiry, and polished invites and the theme. Verified on its Preview with three browsers; the Production check is still open (Current state).
- **Stage 9 — done 2026-10-19 ([PR #11](https://github.com/joepetrillo/vunu/pull/11)).** The full catalog sync (section 2). Done when: the full catalog loaded, a cancelled run was resumed by the next, a forced failure sent a Healthchecks alert, and the first scheduled run succeeded. Then the vote floor went to 1,000 ([PR #13](https://github.com/joepetrillo/vunu/pull/13)).
- **Deck filters and a fresh slate — 2026-10-19 ([PR #12](https://github.com/joepetrillo/vunu/pull/12)).** Animation and age rating; "In the mood for" first, and as a sheet on the deck. A one-time migration (`fresh_slate`) deleted every Not seen and every Watched list, keeping seen lists, groups, and members (owner's call: only family and friends used it). The answer log stays, so a retry sent during the deploy is still recognized; its answers are marked undone, so seen entries from earlier deck answers can't be undone from the deck.
- **Polish — 2026-10-20 ([PR #14](https://github.com/joepetrillo/vunu/pull/14)–[#16](https://github.com/joepetrillo/vunu/pull/16)).** Lucide icons and the scroll decision (section 6), our own `CodeInput` replacing shadcn's input-otp (AGENTS.md), and e2e tests that wait for the app to start before tapping.

### Gotchas

- Svelte: `{...}` inside a quoted attribute is still an expression (`pattern="[0-9]{6}"` became `[0-9]6`).
- Svelte: a one-way `open={...}` on `<details>` is re-applied when Svelte updates the form, closing a panel the person opened; use `bind:open`.
- Kit 3: `SubmitFunction` comes from `$app/forms` (or a route's `./$types`), not `@sveltejs/kit`.
- eslint-plugin-svelte requires an `href` typed exactly `ResolvedPathname`, so links built with a query string go through `resolve()`.
- Chrome adds a space around visually hidden (`sr-only`) text when naming a button ("Seen it : Inception"), so row buttons use `aria-label`.
- E2E sign-in decrypts the pending code from `verifications` using Better Auth 1.7's identifier and encryption format; recheck it after Better Auth upgrades.
- The build warns about optional modules (`pg-native`, `cloudflare:sockets`, `bufferutil`, …). Harmless: Vercel's Node runtime never loads them.

## 8. Linting and formatting decision

- **ESLint:** the official Svelte setup (`sv add eslint`: eslint-plugin-svelte, which understands markup, runes, and SvelteKit conventions) upgraded to typescript-eslint's **strictTypeChecked + stylisticTypeChecked** configs.
- **oxfmt** formats everything, including `.svelte` files, and sorts Tailwind classes (reads `src/routes/layout.css`). Config: `oxfmt.config.ts`. Chosen over Prettier (Sep 2026): its Svelte support is still labeled experimental, but on this repo and a stress-test component it produced output identical to Prettier + prettier-plugin-svelte + prettier-plugin-tailwindcss, with one tool instead of three. Fallback if it ever mangles a file: `oxfmt --migrate` has a Prettier counterpart, and Prettier's config is a few lines.
- `eslint-config-prettier` stays: it only switches off ESLint style rules so ESLint never fights the formatter.
- **svelte-check** with `--fail-on-warnings`.
- TypeScript `strict` plus `noUncheckedIndexedAccess`.
- CI (GitHub Actions) runs lint, svelte-check, unit/browser/database tests, and Playwright against a production build on pushes to `main` and pull requests.
- **Mechanical rules are lint, not prose (Oct 2026):** custom ESLint rules reject Kit 2 imports (`$lib`, `$app/environment`, `$app/stores`) with a message naming the Kit 3 replacement, and writes to guarded tables outside their one module (the write paths in AGENTS.md; tests exempt). `invalidateAll` is already caught by `@typescript-eslint/no-deprecated`.
- **Pre-commit hook (Oct 2026):** simple-git-hooks runs `bun run lint` (about 8 s). Chosen over lint-staged/husky for one dependency and no extra config; it lints the whole working tree, not just staged files. `verify` starts with `bun install --frozen-lockfile`, because a stale `node_modules` once made checks run against the previous Kit RC.
- **Why not Ultracite:** tried at setup (Sep 2026). Its ESLint Svelte preset didn't configure the Svelte parser (every `.svelte` file failed to parse) and its rules clashed with SvelteKit conventions (`+page.svelte` file names, `.svelte.spec.ts` tests). Its Oxlint backend only lints `<script>` blocks. Revisit if either improves.
