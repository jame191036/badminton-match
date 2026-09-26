# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # production build
npm run preview  # serve the build
npm run lint     # eslint .
npm run check    # assert-based self-check of src/utils/{pairing,ranking,billing,promptpay}.js
```

No test framework is set up in this repo.

Requires a `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `env.example`). Without them the app renders but every Supabase call fails; `src/lib/supabaseClient.js` only logs an error.

## What this is

A badminton club ("ก๊วน") manager, two layers deep: a **club** is the standing group, a **day of play** is one outing inside it. Set up master data once (players, venues, shuttle brands) → plan a day (date, courts, who is coming, prices) → run it (fair waiting queue → auto-pair balanced doubles onto courts → finish game and requeue) → close it, which freezes the money and stats. All UI copy is Thai; keep new UI strings Thai to match.

Rationale for every structural decision lives in [`docs/redesign-plan.md`](docs/redesign-plan.md) — read it before changing the shape of anything.

Stack: React 19 + Vite (aliased to `rolldown-vite`) + Supabase (auth, Postgres, realtime) + react-router-dom + `qrcode-generator` (only to draw the PromptPay QR). No state library, no CSS framework — plain CSS in `src/index.css` / `src/app.css` driven by CSS variables and a `data-theme` attribute.

## Architecture

**Layering is strict — respect it.** Components under `src/components/` are presentational only: they receive props and never import `supabase`. All data access lives in `src/hooks/` (simple load-and-refetch hooks share `useLoad`); `src/pages/` wires hooks to components.

Routes (`src/App.jsx`): `/` club list · `/master` master data (3 tabs) · `/club/:clubId` the club's days + sharing · `/club/:clubId/day/:sessionId` the board for one day. `AppLayout` holds the header and passes the signed-in `user` down through the router outlet context.

Auth is email + password (`useAuth`), with a reset-password flow: `onAuthStateChange` firing `PASSWORD_RECOVERY` flips `recovery`, and `App` then renders `ResetPassword` instead of any route. Supabase's English auth errors are translated to Thai in one place, `toThaiError` in `useAuth.js`.

**`useBadmintonData.js` is the core.** Its design choices:
- One `refetchAll()` fetches players, courts, active matches, and history in parallel; realtime `postgres_changes` subscriptions just call `refetchAll` instead of diffing state. Deliberately simple — follow this pattern rather than introducing incremental state updates.
- DB rows are snake_case; `mapPlayer()` converts to the camelCase shape components expect (`games_played`→`gamesPlayed`, `queue_seq`→`queuedAt`).
- Single-table writes go through `supabase.from(...)`; anything touching multiple tables goes through an RPC in `supabase/functions.sql` so it is one transaction.
- `match_players` has no `session_id` column, so its subscription has no filter and fires for all rows; `refetchAll` filters.

**Pairing logic is pure and isolated** in `src/utils/pairing.js` — keep it that way; it, `ranking.js`, `billing.js` and `promptpay.js` in `src/utils/` are the parts of the app testable without a database. Node runs them directly for `npm run check`, so imports between them must carry the `.js` extension. Skill is 1–3 and `SKILL_LEVELS` here is the single source of the labels.

`pickNextMatch(waiting, { mode, pairStats, forceRest })` is controlled by **two independent settings**, not one list of modes. `sessions.queue_mode` picks how pairs are chosen and `sessions.force_rest` toggles the rest rule; every combination is valid, so the UI shows two controls rather than three buttons.

**`queue_mode` — does it look at pair history?**
- `sequential` — sort by `gamesPlayed` then `queuedAt`, take the first 4, and pick the 2v2 split with the smallest skill-sum gap. Never reads `pairStats`.
- `rotate` — `fairPool` first drops anyone who has played more games than the 4th-least-played waiting player, then takes the first `ROTATE_WINDOW` (8) of that fair ordering, enumerates every choice of 4 and every 2v2 split, and scores each with the `WEIGHT` table: repeat partners cost most, then repeat opponents, then skill gap, then how far down the queue it reached. Tune by editing `WEIGHT`. Falls back to the `sequential` split whenever `pairStats` is empty.

  `rotate` is the default for new days. `sequential` requeues the four who finished together as a group, so with a court-multiple of players (8, 12, 16) the same foursomes — and the same partners — repeat all day; a simulated 12-player day gave everyone a single partner ten times over. `WEIGHT.skillGap` is 4 (was 2): in the same simulations it cut the average team skill gap by about a third without losing partner variety.

**Both settings put games played first.** Neither mode will trade an equal game count for pairing variety — see the lexicographic rule below. There is deliberately no "variety above all" option: that was the original `rotate` and it starved players (a simulated 8-player, 20-game day left one player on 0 games).

**Why `force_rest` is its own column and not a third mode.** It was briefly shipped as `queue_mode = 'fair'` (migration 115, replaced by 116) and that was a mistake: the rest rule applies to both modes, so encoding it in the mode name made two entries differ by something invisible from their labels and left the fourth combination unreachable.

The switch matters far more than it looks, because `restFirst` returns **exactly four** players when fewer than four are rested — that leaves `chooseFour` one combination and nothing to choose, so `rotate` collapses to "whoever is available" in precisely the crowded case it exists to help. Turning the rest rule off restores the choice. Simulated over 40 games, partnerships used out of all possible:

| | 10p/2c | 12p/2c | 16p/3c | 17p/4c |
|---|---|---|---|---|
| `sequential`, either switch | 5/45 | 6/66 | 8/120 | 29/136 |
| `rotate` + rest | 44/45 | 18/66 | 24/120 | 46/136 |
| `rotate`, no rest | 45/45 | **62/66** | **78/120** | **68/136** |

Game-count spread stayed 0–1 in every cell, so the switch costs nothing measurable — turning the rest rule **on** only buys real-world freshness, which no simulation can see. That is a real benefit for tired players, which is why it stays on by default; it is not a fairness feature.

  Candidate sets are compared **lexicographically — total games played first, `WEIGHT` score only as the tie-break.** Do not fold games-played into the weighted score: a player who has already partnered everyone present always costs a repeat-partner penalty, which outweighs any skip penalty, so a weighted sum skips them game after game. `sequential` mode is the fallback whenever `pairStats` is empty and is unaffected by any of this.

**Strength is a rating, not the 1–3 label.** `strength(p)` is `p.rating` (the member's Elo rating, learned from scores) and falls back to `skillRating(skill)` = 800 + 100 × skill for guests and members with no scored games yet — `skill_rating()` in SQL must stay the same formula. `skillGap` measures team rating difference in "skill levels" (100 rating = 1), so `WEIGHT.skillGap` kept its meaning. Simulations with hidden true skill showed the rating learns the true order well (rank correlation ≈ 0.7–0.8 after a few days) but moves match closeness only within noise: fairness and the rest rule decide *who* plays, the rating mostly picks among three splits. Raising `skillGap` to 8–12 did not help and made the rating learn less (even games carry little information). `winChance` shows the predicted split on each court card.

**Rest rule:** `pickNextMatch` first drops players with `rested === false` (from `v_session_player_stats.rested`: no game paired after their last one has finished yet). If fewer than four are rested it fills from the rest **ordered by longest resting (`queuedAt`), not by games played** — ordering by games sent a late arrival straight back on court every time, which is what the rule exists to stop. Once more than half the players are on court, nearly nobody is fully rested, so the fill path is the normal case, not an edge case. `substitute_player` and `fill_match` ignore the rule on purpose — a court is waiting.

Avoiding repeat pairings is always a **soft** constraint — with exactly 4 waiting it must still pair them, however often they have played together. `pairStats` is a `Map` from `pairKey(a, b)` to `{ together, against }`, built in `useBadmintonData` from `v_pair_history`; an empty map falls back to sequential.

**Days of play:** one `sessions` row = one outing, belonging to a `clubs` row. `create_play_day` builds the day, its courts and its pre-picked players in one transaction; `last_day_defaults` feeds the form with the club's previous day so the usual case is one confirm. `start_play_day` moves `planned → playing` and refuses while the club already has a live day; `close_session` moves it to `done` and refuses while any match is still `pending` or `playing`.

Closing **freezes** the money and stats into `sessions.final_*` columns; `v_club_days` reads those frozen values for `done` days and never recomputes them. This is deliberate: rates change between outings, and a past outing's total must stay what people actually paid.

Prices may be left at 0 when the day is created — the real numbers are usually known when the day ends, and forcing a guess up front produces figures nobody goes back to correct.

**Members:** `members` is the cross-day identity of a player, one shared list per user account (not per club); `players` is one person's participation in one day and keeps its own `name`/`skill` snapshot, so renaming a member never rewrites history. `add_player` upserts a member by case-insensitive name and links it, so the list also builds itself from walk-ins; pass `p_save_to_master = false` for a one-off guest. When the name already exists it takes that member's name and skill and **never overwrites the master row** — the walk-in skill picker defaults to 2, so writing it back would silently downgrade whoever was typed in. It also refuses a second player with the same name on the same day (guests included), since the board could not tell them apart. `players.member_id` is nullable and `on delete set null`, so deleting a member preserves past days.

**Attendance:** players picked in advance start as `waiting`. `set_player_attendance` flips them to `absent` when they do not show up, which takes them out of the queue **and out of the billing divisor**. Without it, one no-show silently skews everyone's share.

**Sharing:** `club_access` maps a user to a club as `owner` / `editor` / `viewer`. Editors can run a day but cannot share the club onward.

Master data belongs to the **club owner's account**, not to the club, so everyone working on a shared club reads and writes that one owner's lists. Three policies express this on each master table: `has_master_access` grants SELECT to anyone the owner shared a club with, `has_master_edit_access` grants INSERT and UPDATE to those who are `owner`/`editor` there, and DELETE stays with the owner alone (it is irreversible and hits every club of theirs, not just the one the editor helps with). `add_player` writing walk-ins into the owner's `members` is the same rule, which is why edit rights had to match it.

`MasterDataPage` therefore shows a switch for *whose* master data you are viewing, built from `v_my_clubs`. It labels each owner by their club names because `authenticated` cannot read `auth.users` to get an email.

## Database (`supabase/`)

`schema.sql` and `functions.sql` are the source of truth for a fresh database and are applied manually in the Supabase SQL editor. Changes to an existing database go in `supabase/migrations/NNN_name.sql` starting at `101_`, also run by hand — keep both in sync when altering the schema. (The pre-v2 `001`–`005` migrations were deleted; they live only in git history.)

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

**Match lifecycle:** `assign_court` creates the match as `pending` with `started_at` null — pairing does not start the clock. `start_match` (requires exactly 4 players) moves it to `playing` and stamps `started_at`; `finish_match` moves it to `done`. While `pending`, `substitute_player` deletes a player's `match_players` row, sets them `resting`, and pulls the next waiting player into the same team. That deletion is exactly why a substituted player is not credited with the game — `finish_match` only touches rows still present, so no "did they actually play" flag is needed anywhere. Preserve that property when changing either function. `cancel_match` exists so a court cannot get stuck `pending` when a substitution finds no replacement; `fill_match` tops such a match back up from the queue once someone is waiting again (same queue order as `substitute_player`), and `start_match` counts only rows whose `player_id` is not null.

**Scores are optional.** `matches.score_a`/`score_b` are both null or both set, 0–99, never equal (badminton has no draw); `assert_valid_score` gives the Thai messages and the table constraints back it up. `finish_match(match, a, b)` takes them at the end of a game, `set_match_score` corrects them afterwards but only while the day is `playing` — same "a closed day is history" rule as `rename_court`. A game without a score still counts as played; it just stays out of win/loss. **Rating** is computed server-side in `apply_match_rating`, called only from `finish_match` and `set_match_score` (execute is revoked from clients). Team strength = average rating; expected E_A = 1/(1+10^((R_B−R_A)/400)); actual S_A = 0.5 + 0.5·(a−b)/max(a,b), so 21–19 ≈ 0.55 and 21–0 = 1; each member moves by K·(S−E) with K = 48 for their first 10 rated games, then 32. Duration only confirms closeness: games under 3 minutes are not rated, and a game ≥ 1.25× the day's median with a margin ≤ 4 has its (S−0.5) halved. Each `match_players.rating_delta` is stored so `revert_match_rating` can back a game out when its score is corrected; recomputing from current ratings rather than replaying history is a deliberate approximation. Guests have no member, so they get no delta but still count in team strength. `members.rating` null means "not rated yet, use the skill level". `clubs.show_rating` hides the number in the ranking tab from viewers only — it is a courtesy, not access control; the rating stays readable through the API to anyone who can read the owner's members. The club ranking sorts by rating (`byRating`), not win rate: once pairing is balanced, everyone wins about half their games.

Wins, losses and point difference come from `v_session_player_stats` (per day) and `v_club_ranking` (per club, per member — guests have no `member_id` so they are not ranked). The ordering rule lives once in `byRanking` in `ranking.js`: at least `MIN_RANKED_GAMES` scored games first, then win rate, wins, point difference — without the threshold one lucky 1–0 tops everyone.

`assign_court` locks the four player rows and refuses unless all four are distinct, split 2/2, and still `waiting`. The client pairs from its own snapshot, so two quick taps on different courts (or two phones) would otherwise put the same people on two courts — the check has to live in the RPC, not the UI.

Note `players.status = 'playing'` means "assigned to a court", including a `pending` match not yet started — it keeps them out of the waiting pool and out of substitution picks.

All views are declared `security_invoker = on` so RLS on the underlying tables actually applies — without it a view runs as its owner and any authenticated user could read another owner's session by guessing its id. Keep that setting on any new view.

Views `v_match_history`, `v_session_player_stats`, `v_session_summary`, `v_club_days`, `v_my_clubs`, `v_member_stats`, `v_club_ranking` and `v_club_outstanding` are queried. `v_club_days` is the club's calendar — for a `done` day it reads the frozen `final_*` columns and for any other day it shows a live estimate; never make the `done` branch recompute. The list of people a club is shared with is an RPC (`list_club_members`), not a view, because `authenticated` cannot select from `auth.users` and `security_invoker` would therefore fail.

Minutes played are derived from `matches.started_at`/`ended_at` in `v_session_player_stats` and merged onto players as `minutesPlayed` — `players.games_played` stays the column that drives queue order. Billing is recomputed client-side in `BillingPanel.jsx` and must stay in agreement with `v_billing_summary`:

```
court   = Σ(courts.hours) × sessions.hourly_rate   -- 1 court row = 1 booking, so hours are per court
shuttle = sessions.shuttle_count × sessions.shuttle_price
each    = (court + shuttle) / players where paying and status <> 'absent'
```

The split is **equal among everyone who actually turned up** — never per game or per minute played. Two exclusions only: `paying = false`, and `status = 'absent'` (signed up in advance but did not come). Resting and playing players still count as payers.

The formula exists once client-side, `computeBilling` in `src/utils/billing.js`; both the billing tab and the collect tab use it.

**Collecting money.** `players.paid_at` (null = unpaid) is ticked from the day's "เก็บเงิน" tab or the club's "ค้างจ่าย" tab — a plain single-table update, allowed for owner/editor by the existing players policy, **including after the day is closed**, because most people transfer after playing. `v_club_outstanding` lists one row per payer per `done` day still unpaid, at the frozen `final_per_person`; a day still playing is never debt because its total can move. The app groups those rows per member across days (`groupOutstanding`); guests have no member, so each of their days stays separate and the reminder text dates them. The collect tab also shows each member's unpaid earlier days and can settle today plus those in one tap.

PromptPay lives on the club (`promptpay_id`, `promptpay_name`), set by the owner only (clubs update policy) and readable by every member — they need it to pay. `promptPayPayload` builds the EMVCo string by hand (tag-length-value + CRC-16/CCITT-FALSE); it was checked byte-for-byte against the `promptpay-qr` library and by decoding the rendered QR, and `npm run check` pins those payloads. Messages go out through `navigator.share` on phones (so LINE is one tap) and fall back to the clipboard.

Prices live on the day, never on the master row. `venues.default_hourly_rate` exists purely to prefill the form and is copied into `sessions.hourly_rate`; nothing reads it at billing time. `shuttle_brands` deliberately has no price column at all.

Realtime must be enabled for `players`, `courts`, `matches`, `match_players`, `sessions` — the `alter publication supabase_realtime ...` line in `schema.sql` is commented out, so it is done in the dashboard.

**Exporting a day report.** `buildDayReport` in `src/utils/report.js` is the single data model; `DayReport.jsx` renders it as DOM for printing and `reportImage.js` draws the same model onto a canvas as a PNG. Both must show the same numbers, which is why the model is one pure, node-checked function rather than two renderers each doing their own arithmetic — and why it, not the callers, decides that a `done` day reads `final_*` while any other day reads the live `computeBilling` result.

PDF is `window.print()` plus a `@media print` block, deliberately not jsPDF: jsPDF cannot lay out Thai (tone marks land in the wrong place) without an embedded Thai font, which would cost a few hundred KB for a worse result, while the browser already renders the page correctly and keeps the text selectable. The print block hides the whole UI and reveals `.print-only`, and `DayReport` sits outside the tab switch so printing works from any tab — printing the live page would only ever capture whichever tab happens to be open.

The PNG is hand-drawn on a canvas instead of going through html2canvas for two reasons: html2canvas must inline cross-origin CSS and webfonts (ours come from Google Fonts) and silently falls back to the wrong font when that fails, and the image exists to be shared into LINE, so it wants its own light-background layout rather than a screenshot of the dark UI with nav and buttons still in it. `reportImage.js` is the one file in `src/utils/` that cannot run under node, so `npm run check` covers `report.js` only.

## Note

`README.md` is the user-facing guide: what the app does, how to run a session, the money rules, and setup. Keep it in Thai and keep it free of the internals — this file is where the invariants and reasoning live.
