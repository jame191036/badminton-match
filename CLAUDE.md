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

A badminton club ("ก๊วน") session manager: add players → fair waiting queue → auto-pair balanced doubles onto courts → finish game and requeue → match history → split court/shuttle fees. All UI copy is Thai; keep new UI strings Thai to match.

Stack: React 19 + Vite (aliased to `rolldown-vite`) + Supabase (auth, Postgres, realtime). No router, no state library, no CSS framework — plain CSS in `src/index.css` / `src/app.css` driven by CSS variables and a `data-theme` attribute.

## Architecture

**Layering is strict — respect it.** Components under `src/components/` are presentational only: they receive props and never import `supabase`. All data access lives in `src/hooks/`, and `src/App.jsx` wires hooks to components.

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

**Sessions:** one session = one outing, not a permanent club. `useGameSession` calls `get_or_create_my_session`, which returns the owner's session with `closed_at is null` (creating one, plus a first court, if there is none). A user has at most one open session at a time — `open_session` refuses while one is open, and `close_session` refuses while any match is still `pending` or `playing`.

Closing **freezes** the money and stats into `sessions.final_*` columns; `v_session_archive` reads those frozen values and never recomputes. This is deliberate: rates change between outings, and a past outing's total must stay what people actually paid. Never make the archive derive its numbers live.

While `sessionId` is null (just closed, nothing opened yet) `App` renders `NewSessionPanel` instead of the board.

**Members:** `members` is the cross-session identity of a player; `players` is one person's participation in one session and keeps its own `name`/`skill` snapshot, so renaming a member never rewrites history. The list builds itself — `add_player` upserts a member by case-insensitive name and links it, so there is no separate member-management screen. `players.member_id` is nullable for guests and `on delete set null`, so deleting a member preserves past sessions.

## Database (`supabase/`)

`schema.sql` and `functions.sql` are the source of truth for a fresh database and are applied manually in the Supabase SQL editor. Changes to an existing database go in `supabase/migrations/NNN_name.sql`, also run by hand — keep both in sync when altering the schema. Shape: `sessions → players / courts / matches → match_players`, everything reachable from `sessions.owner_id`, RLS on every table.

Non-obvious invariants to preserve when changing SQL:
- `players.queue_seq` is a `bigserial`, not a timestamp — queue order is bumped by `nextval(...)` when a player finishes a game or resumes from rest, which is why ties can't collide.
- `match_players` snapshots `player_name` and `skill`, and `matches` snapshots `court_name`, so history survives deleting players or courts.
- A partial unique index on `matches(court_id) where ended_at is null` enforces one live match per court. "Active match" always means `ended_at is null`, which covers both `pending` and `playing`.
- Every RPC is `SECURITY DEFINER`, so each one must re-check `owner_id = auth.uid()` by hand. Any new RPC must do the same and be granted to `authenticated`.
- `finish_match` counts the game (+1 `games_played`) and requeues; `remove_court` and `cancel_match` return players without counting the game or moving them in the queue.

**Match lifecycle:** `assign_court` creates the match as `pending` with `started_at` null — pairing does not start the clock. `start_match` (requires exactly 4 players) moves it to `playing` and stamps `started_at`; `finish_match` moves it to `done`. While `pending`, `substitute_player` deletes a player's `match_players` row, sets them `resting`, and pulls the next waiting player into the same team. That deletion is exactly why a substituted player is not credited with the game — `finish_match` only touches rows still present, so no "did they actually play" flag is needed anywhere. Preserve that property when changing either function. `cancel_match` exists so a court cannot get stuck `pending` when a substitution finds no replacement.

Note `players.status = 'playing'` means "assigned to a court", including a `pending` match not yet started — it keeps them out of the waiting pool and out of substitution picks.

All views are declared `security_invoker = on` so RLS on the underlying tables actually applies — without it a view runs as its owner and any authenticated user could read another owner's session by guessing its id. Keep that setting on any new view.

Views `v_waiting_queue`, `v_court_board` exist but the client does not use them; `v_match_history`, `v_session_player_stats` and `v_session_summary` are queried. Minutes played are derived from `matches.started_at`/`ended_at` in `v_session_player_stats` and merged onto players as `minutesPlayed` — `players.games_played` stays the column that drives queue order. Billing is recomputed client-side in `BillingPanel.jsx` and must stay in agreement with `v_billing_summary`:

```
court   = Σ(courts.hours) × sessions.hourly_rate   -- 1 court row = 1 booking, so hours are per court
shuttle = sessions.shuttle_count × sessions.shuttle_price
each    = (court + shuttle) / players where paying
```

`sessions.legacy_court_fee` / `legacy_shuttle_fee` are the pre-hourly flat totals, kept only for reference — nothing reads them.

The split is **equal among everyone present** — never per game or per minute played — and `players.paying` is the only exclusion. Resting and playing players still count as payers.

Realtime must be enabled for `players`, `courts`, `matches`, `match_players` — the `alter publication supabase_realtime ...` line in `schema.sql` is commented out, so it is done in the dashboard.

## Note

`README.md` is still the stock Vite template and does not describe this project.
