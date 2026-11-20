# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # production build
npm run preview  # serve the build
npm run lint     # eslint .
npm run check    # assert-based self-check of src/utils/{pairing,billing,promptpay,report}.js
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

**Pairing logic is pure and isolated** in `src/utils/pairing.js` — keep it that way; it, `billing.js`, `promptpay.js` and `report.js` in `src/utils/` are the parts of the app testable without a database. Node runs them directly for `npm run check`, so imports between them must carry the `.js` extension. Skill is 1–3 and `SKILL_LEVELS` here is the single source of the labels.

`pickNextMatch(waiting, { mode, pairStats, forceRest })` is controlled by **two independent settings**, not one list of modes. `sessions.queue_mode` picks how pairs are chosen and `sessions.force_rest` toggles the rest rule; every combination is valid, so the UI shows two controls rather than three buttons.

**`queue_mode` — how are the four picked?**
- `sequential` — sort by `gamesPlayed` then `queuedAt`, take the first 4, and pick the 2v2 split with the smallest skill-sum gap. Never reads `pairStats`.
- `rotate` — `fairPool` first drops anyone who has played more games than the 4th-least-played waiting player, then takes the first `ROTATE_WINDOW` (8) of that fair ordering, enumerates every choice of 4 and every 2v2 split, and scores each with the `WEIGHT` table: repeat partners cost most, then repeat opponents, then skill gap, then how far down the queue it reached. Tune by editing `WEIGHT`. Falls back to the `sequential` split whenever `pairStats` is empty.

  `rotate` is the default for new days. `sequential` requeues the four who finished together as a group, so with a court-multiple of players (8, 12, 16) the same foursomes — and the same partners — repeat all day; a simulated 12-player day gave everyone a single partner ten times over. `WEIGHT.skillGap` is 4 (was 2): in the same simulations it cut the average team skill gap by about a third without losing partner variety.

- `variety` — the odd one out: partner freshness is scored on its own (`VARIETY_WEIGHT`, where `together` is 100 and `queueSkip` is 0) and **games played does not enter the comparison at all**, so it will happily reach past the head of the queue for a fresher pairing. It ignores `force_rest` entirely (`IGNORES_FORCE_REST` drives the UI to disable the checkbox rather than let it silently do nothing), because `restFirst` cuts the pool to exactly four and would destroy the only thing this mode exists for. `VARIETY_WINDOW` is 10 rather than 8 since more candidates means fresher pairs; C(10,4) x 3 splits is 630 scorings per court, which is nothing.

  Over 40 simulated games it uses the most distinct partnerships of any setting — 66/66 at 12 players on 2 courts (vs 62 for `rotate` with rest off and 18 with it on), 80/120 at 16p/3c with **zero** repeated pairs — at the cost of a game spread of about 2 instead of 0–1.

  **Its starvation cap is a forced inclusion, not a pool filter, and that distinction is the whole thing.** Anyone more than `VARIETY_MAX_AHEAD` (3) games behind the window maximum is required to be in the chosen four. Filtering the candidate pool by the same threshold looks equivalent and is not: once only one player is behind, the filtered pool falls below four, the code has to widen it back to the whole queue, and the cap stops binding exactly when it is needed. That version was written first and measured — the starved player finished a simulated 20-game day on 0 games, 12 behind. With forced inclusion the same case gives them 7 games and a spread of 4. `npm run check` pins this.
**Both settings put games played first.** Neither mode will trade an equal game count for pairing variety — see the lexicographic rule below. `variety` is the exception and is described above; its cap is what keeps "variety above all" from starving anyone, which is what the original `rotate` did before commit 956b16a.

**Why `force_rest` is its own column and not a third mode.** It was briefly shipped as `queue_mode = 'fair'` (migration 115, replaced by 116) and that was a mistake: the rest rule applies to both modes, so encoding it in the mode name made two entries differ by something invisible from their labels and left the fourth combination unreachable.

The switch matters far more than it looks, because `restFirst` returns **exactly four** players when fewer than four are rested — that leaves `chooseFour` one combination and nothing to choose, so `rotate` collapses to "whoever is available" in precisely the crowded case it exists to help. Turning the rest rule off restores the choice. Simulated over 40 games, partnerships used out of all possible:

| | 10p/2c | 12p/2c | 16p/3c | 17p/4c |
|---|---|---|---|---|
| `sequential`, either switch | 5/45 | 6/66 | 8/120 | 29/136 |
| `rotate` + rest | 44/45 | 18/66 | 24/120 | 46/136 |
| `rotate`, no rest | 45/45 | **62/66** | **78/120** | **68/136** |

Game-count spread stayed 0–1 in every cell, so the switch costs nothing measurable — turning the rest rule **on** only buys real-world freshness, which no simulation can see. That is a real benefit for tired players, which is why it stays on by default; it is not a fairness feature.

**That "0–1" was only true in that simulation.** It broke ties between the four who finish one game in a different order than the real database does. `finish_match` hands the four out `queue_seq` in table-row order, the same order every game, and the old fill sorted by `queue_seq` — so whenever only some of a just-finished four were needed, it was always the same ones (usually whoever was added to the day first), back on court every game and always together. Re-simulated with that real order (rotate + rest, 30 days × 30 games): spread 5.6 games at 9p/2c and 10p/2c, 3.3 at 14p/3c. The tie fix in the rest rule (below) brings those to 1.2, 0.5 and 1.1, and distinct partnerships at 10p/2c from 31/45 to 43/45. 12p/2c (18/66) and 16p/3c (24/120) are unchanged: there the rested group is exactly four, which is the rest rule working as designed.

  Candidate sets are compared **lexicographically — total games played first, `WEIGHT` score only as the tie-break.** Do not fold games-played into the weighted score: a player who has already partnered everyone present always costs a repeat-partner penalty, which outweighs any skip penalty, so a weighted sum skips them game after game. `sequential` mode is the fallback whenever `pairStats` is empty and is unaffected by any of this.

**Strength is the 1–3 skill label.** `skillGap` is the difference of the two teams' skill sums. There used to be an Elo rating learned from scores; scoring was removed entirely in migration 119 (scores, rating, ranking tab, win-chance badge) at the user's request. Its own simulations had already shown the rating moved match closeness only within noise — fairness and the rest rule decide *who* plays, strength only picks among three splits — so nothing in pairing depended on it.

**Rest rule:** `pickNextMatch` first drops players with `rested === false` (from `v_session_player_stats.rested`: no game paired after their last one has finished yet). If fewer than four are rested it fills from the rest **ordered by longest resting (`lastEndedAt`, from `v_session_player_stats.last_ended_at`), not by games played** — ordering by games sent a late arrival straight back on court every time, which is what the rule exists to stop. Once more than half the players are on court, nearly nobody is fully rested, so the fill path is the normal case, not an edge case. `substitute_player` and `fill_match` ignore the rule on purpose — a court is waiting.

The four who finished the same game share one `last_ended_at` exactly, so they are a **tie**, and the tie must not be broken by `queuedAt` (see the correction under the table above). `restFirst` therefore returns everyone rested longer as `forced`, plus the whole tie group, and lets the mode choose from the tie: `sequential` takes them by `byFairness`, `rotate` by its usual games-first-then-`WEIGHT` comparison over sets that contain every forced player. Do not compare by `queuedAt` here — it looks like "longest resting" and is really table-row order.

**When everyone waiting plays this round** (`freeCourts` × 4 ≥ waiting count, and the count is a multiple of 4 — e.g. 8 players waiting with 2 courts free), `pickNextMatch` skips both the rest rule and games-first and picks purely by pair freshness, because neither can change who plays any more, only who plays with whom. Without this, at 8 players on 2 courts the group that finished first was always put back as a block and the two foursomes never mixed even when the organiser waited for both courts. `assignCourt` passes `freeCourts` from the courts that have no match. At exactly 8p/2c with courts paired the moment they free up, the pool is always the four who just finished; no mode can mix them, and the README tells organisers to wait for both courts.

**Repeat-group warning.** `repeatGroupReason` (pure, in `pairing.js`) answers "will pressing pair now put back a whole foursome whose last game was together (same `lastEndedAt`), and why": `'wait'` when only those four are waiting and another court has a match (8p/2c), `'rest'` when more are waiting but `restFirst` narrowed the pool to exactly them (12p and 16p on 2 courts with rest on), else `null`. It returns null whenever nothing would help — no other court to wait for, rest off, or `sequential` (which repeats groups by design and says so in its hint). `useBadmintonData` computes it as `repeatGroup` with the same options `assignCourt` passes, so the warning always describes the pick the button will make; `CourtBoard` shows it on the first empty court only. Simulated 2-court days: it fires on 92% of picks at 8p, 88% at 12p and 85% at 16p with rest on — exactly the picks that repeat a group — and 0% at 9–11 and 13–14 players. Keep it that quiet: a warning on every pick would be ignored.

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

**Court card gestures.** Actions that cannot be undone and happen all day are not single taps. Start and finish use `SlideToConfirm`: drag the knob past 80% or fling it, and keyboard users press Enter/Space on the knob. Benching is a 600 ms press-and-hold on the player tile (`CourtBoard`'s `PlayerTile`), because a stray tap while scrolling at the courtside used to end games and bench people. Reversible actions stay taps: assign, fill, and cancel (cancel sends everyone back to the head of the queue without counting the game). `SlideToConfirm` treats a `false` return from `onConfirm` as failure and springs back, and `run()` in `useBadmintonData` returns `false` when an RPC fails, so the hook actions must keep returning that rather than throwing. Every card shares `--court-card-min-h`, the height of the tallest state (pending, measured at 375px), so finishing a game never shifts the cards below it.

**No scores.** The app does not record game scores, win/loss, rating or a club ranking — all of it (migrations 112/113) was removed in 119, data included. `finish_match(match)` takes only the match. If scoring ever comes back, nothing in pairing needs it (see "Strength is the 1–3 skill label").

`assign_court` locks the four player rows and refuses unless all four are distinct, split 2/2, and still `waiting`. The client pairs from its own snapshot, so two quick taps on different courts (or two phones) would otherwise put the same people on two courts — the check has to live in the RPC, not the UI.

Note `players.status = 'playing'` means "assigned to a court", including a `pending` match not yet started — it keeps them out of the waiting pool and out of substitution picks.

All views are declared `security_invoker = on` so RLS on the underlying tables actually applies — without it a view runs as its owner and any authenticated user could read another owner's session by guessing its id. Keep that setting on any new view.

Views `v_match_history`, `v_session_player_stats`, `v_session_summary`, `v_club_days`, `v_my_clubs`, `v_member_stats` and `v_club_outstanding` are queried. `v_club_days` is the club's calendar — for a `done` day it reads the frozen `final_*` columns and for any other day it shows a live estimate; never make the `done` branch recompute. The list of people a club is shared with is an RPC (`list_club_members`), not a view, because `authenticated` cannot select from `auth.users` and `security_invoker` would therefore fail.

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
