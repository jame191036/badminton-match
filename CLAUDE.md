# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # production build
npm run preview  # serve the build
npm run lint     # eslint .
```

No test framework is set up in this repo.

Requires a `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `env.example`). Without them the app renders but every Supabase call fails; `src/lib/supabaseClient.js` only logs an error.

## What this is

A badminton club ("ก๊วน") manager, two layers deep: a **club** is the standing group, a **day of play** is one outing inside it. Set up master data once (players, venues, shuttle brands) → plan a day (date, courts, who is coming, prices) → run it (fair waiting queue → auto-pair balanced doubles onto courts → finish game and requeue) → close it, which freezes the money and stats. All UI copy is Thai; keep new UI strings Thai to match.

Rationale for every structural decision lives in [`docs/redesign-plan.md`](docs/redesign-plan.md) — read it before changing the shape of anything.

Stack: React 19 + Vite (aliased to `rolldown-vite`) + Supabase (auth, Postgres, realtime) + react-router-dom. No state library, no CSS framework — plain CSS in `src/index.css` / `src/app.css` driven by CSS variables and a `data-theme` attribute.

## Architecture

**Layering is strict — respect it.** Components under `src/components/` are presentational only: they receive props and never import `supabase`. All data access lives in `src/hooks/`; `src/pages/` wires hooks to components.

Routes (`src/App.jsx`): `/` club list · `/master` master data (3 tabs) · `/club/:clubId` the club's days + sharing · `/club/:clubId/day/:sessionId` the board for one day. `AppLayout` holds the header and passes the signed-in `user` down through the router outlet context.

Auth is email + password (`useAuth`), with a reset-password flow: `onAuthStateChange` firing `PASSWORD_RECOVERY` flips `recovery`, and `App` then renders `ResetPassword` instead of any route. Supabase's English auth errors are translated to Thai in one place, `toThaiError` in `useAuth.js`.

**`useBadmintonData.js` is the core.** Its design choices:
- One `refetchAll()` fetches players, courts, active matches, and history in parallel; realtime `postgres_changes` subscriptions just call `refetchAll` instead of diffing state. Deliberately simple — follow this pattern rather than introducing incremental state updates.
- DB rows are snake_case; `mapPlayer()` converts to the camelCase shape components expect (`games_played`→`gamesPlayed`, `queue_seq`→`queuedAt`).
- Single-table writes go through `supabase.from(...)`; anything touching multiple tables goes through an RPC in `supabase/functions.sql` so it is one transaction.
- `match_players` has no `session_id` column, so its subscription has no filter and fires for all rows; `refetchAll` filters.

**Pairing logic is pure and isolated** in `src/utils/pairing.js` — keep it that way; it is the only part of the app testable without a database. Skill is 1–3 and `SKILL_LEVELS` here is the single source of the labels.

`pickNextMatch(waiting, { mode, pairStats })` has two modes, chosen by `sessions.queue_mode`:
- `sequential` — sort by `gamesPlayed` then `queuedAt`, take the first 4, and split with `bestTeamSplit` (smallest skill-sum gap).
- `rotate` — consider the first `ROTATE_WINDOW` (8) of that same fair ordering, enumerate every choice of 4 and every 2v2 split, and take the lowest score from the `WEIGHT` table: repeat partners cost most, then repeat opponents, then skill gap, then how far down the queue it reached. Tune by editing `WEIGHT`.

Avoiding repeat pairings is always a **soft** constraint — with exactly 4 waiting it must still pair them, however often they have played together. `pairStats` is a `Map` from `pairKey(a, b)` to `{ together, against }`, built in `useBadmintonData` from `v_pair_history`; an empty map falls back to sequential.

**Days of play:** one `sessions` row = one outing, belonging to a `clubs` row. `create_play_day` builds the day, its courts and its pre-picked players in one transaction; `last_day_defaults` feeds the form with the club's previous day so the usual case is one confirm. `start_play_day` moves `planned → playing` and refuses while the club already has a live day; `close_session` moves it to `done` and refuses while any match is still `pending` or `playing`.

Closing **freezes** the money and stats into `sessions.final_*` columns; `v_club_days` reads those frozen values for `done` days and never recomputes them. This is deliberate: rates change between outings, and a past outing's total must stay what people actually paid.

Prices may be left at 0 when the day is created — the real numbers are usually known when the day ends, and forcing a guess up front produces figures nobody goes back to correct.

**Members:** `members` is the cross-day identity of a player, one shared list per user account (not per club); `players` is one person's participation in one day and keeps its own `name`/`skill` snapshot, so renaming a member never rewrites history. `add_player` upserts a member by case-insensitive name and links it, so the list also builds itself from walk-ins; pass `p_save_to_master = false` for a one-off guest. `players.member_id` is nullable and `on delete set null`, so deleting a member preserves past days.

**Attendance:** players picked in advance start as `waiting`. `set_player_attendance` flips them to `absent` when they do not show up, which takes them out of the queue **and out of the billing divisor**. Without it, one no-show silently skews everyone's share.

**Sharing:** `club_access` maps a user to a club as `owner` / `editor` / `viewer`. Editors can run a day but cannot share the club onward.

Master data belongs to the **club owner's account**, not to the club, so everyone working on a shared club reads and writes that one owner's lists. Three policies express this on each master table: `has_master_access` grants SELECT to anyone the owner shared a club with, `has_master_edit_access` grants INSERT and UPDATE to those who are `owner`/`editor` there, and DELETE stays with the owner alone (it is irreversible and hits every club of theirs, not just the one the editor helps with). `add_player` writing walk-ins into the owner's `members` is the same rule, which is why edit rights had to match it.

`MasterDataPage` therefore shows a switch for *whose* master data you are viewing, built from `v_my_clubs`. It labels each owner by their club names because `authenticated` cannot read `auth.users` to get an email.

## Database (`supabase/`)

`schema.sql` and `functions.sql` are the source of truth for a fresh database and are applied manually in the Supabase SQL editor. Changes to an existing database go in `supabase/migrations/NNN_name.sql` starting at `101_`, also run by hand — keep both in sync when altering the schema. (`migrations/001`–`005` are pre-v2 and must never be run against the current schema; see the README there.)

Shape: `clubs → sessions → players / courts / matches → match_players`, with master tables `members` / `venues` / `shuttle_brands` hanging off `auth.users`. RLS on every table.

**`sessions` means "one day of play", not "a club".** A `clubs` row is the permanent group. `sessions.status` is `planned → playing → done` (plus `cancelled`), so a day can be entered days in advance and sit there until played.

**`venues` ≠ `courts`.** `venues` is master data for the *place*; `courts` is still one row per court booked *that day*, carrying the hours that multiply into the court fee. Conflating them breaks billing.

Non-obvious invariants to preserve when changing SQL:
- `players.queue_seq` is a `bigserial`, not a timestamp — queue order is bumped by `nextval(...)` when a player finishes a game or resumes from rest, which is why ties can't collide.
- `match_players` snapshots `player_name` and `skill`; `matches` snapshots `court_name`; `sessions` snapshots `venue_name` and `shuttle_brand_name`. History survives deleting any master row.
- A partial unique index on `matches(court_id) where ended_at is null` enforces one live match per court. "Active match" always means `ended_at is null`, which covers both `pending` and `playing`.
- A partial unique index on `sessions(club_id) where status = 'playing'` enforces one live day per club. This replaced the old "one open session per user" rule.
- Every RPC is `SECURITY DEFINER`, so each one must re-check access by hand — via `can_edit_club(club_id)` or `can_edit_session(session_id)`, never `owner_id = auth.uid()`. Any new RPC must do the same and be granted to `authenticated`.
- Those `can_*` helpers are themselves `SECURITY DEFINER`, which is what stops the RLS policy on `club_access` from recursing into itself.
- `clubs` has no insert policy on purpose — `create_club()` is the only way in, because a club inserted directly would have no `club_access` row and be invisible even to its creator.
- `finish_match` counts the game (+1 `games_played`) and requeues; `remove_court` and `cancel_match` return players without counting the game or moving them in the queue.

**Match lifecycle:** `assign_court` creates the match as `pending` with `started_at` null — pairing does not start the clock. `start_match` (requires exactly 4 players) moves it to `playing` and stamps `started_at`; `finish_match` moves it to `done`. While `pending`, `substitute_player` deletes a player's `match_players` row, sets them `resting`, and pulls the next waiting player into the same team. That deletion is exactly why a substituted player is not credited with the game — `finish_match` only touches rows still present, so no "did they actually play" flag is needed anywhere. Preserve that property when changing either function. `cancel_match` exists so a court cannot get stuck `pending` when a substitution finds no replacement.

Note `players.status = 'playing'` means "assigned to a court", including a `pending` match not yet started — it keeps them out of the waiting pool and out of substitution picks.

All views are declared `security_invoker = on` so RLS on the underlying tables actually applies — without it a view runs as its owner and any authenticated user could read another owner's session by guessing its id. Keep that setting on any new view.

Views `v_waiting_queue`, `v_court_board` exist but the client does not use them; `v_match_history`, `v_session_player_stats`, `v_session_summary`, `v_club_days`, `v_my_clubs` and `v_member_stats` are queried. `v_club_days` is the club's calendar — for a `done` day it reads the frozen `final_*` columns and for any other day it shows a live estimate; never make the `done` branch recompute. The list of people a club is shared with is an RPC (`list_club_members`), not a view, because `authenticated` cannot select from `auth.users` and `security_invoker` would therefore fail.

Minutes played are derived from `matches.started_at`/`ended_at` in `v_session_player_stats` and merged onto players as `minutesPlayed` — `players.games_played` stays the column that drives queue order. Billing is recomputed client-side in `BillingPanel.jsx` and must stay in agreement with `v_billing_summary`:

```
court   = Σ(courts.hours) × sessions.hourly_rate   -- 1 court row = 1 booking, so hours are per court
shuttle = sessions.shuttle_count × sessions.shuttle_price
each    = (court + shuttle) / players where paying and status <> 'absent'
```

The split is **equal among everyone who actually turned up** — never per game or per minute played. Two exclusions only: `paying = false`, and `status = 'absent'` (signed up in advance but did not come). Resting and playing players still count as payers.

Prices live on the day, never on the master row. `venues.default_hourly_rate` exists purely to prefill the form and is copied into `sessions.hourly_rate`; nothing reads it at billing time. `shuttle_brands` deliberately has no price column at all.

Realtime must be enabled for `players`, `courts`, `matches`, `match_players`, `sessions` — the `alter publication supabase_realtime ...` line in `schema.sql` is commented out, so it is done in the dashboard.

## Note

`README.md` is still the stock Vite template and does not describe this project.
