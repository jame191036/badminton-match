-- ============================================================
-- Badminton Club Manager — Supabase Schema (v2)
-- ------------------------------------------------------------
-- โครงสร้าง 2 ชั้น:
--   master  : clubs / members / venues / shuttle_brands  — ของถาวร ตั้งไว้ล่วงหน้า
--   รายวัน  : sessions (= "วันเล่น") / players / courts / matches / match_players
--
-- คำที่สับสนง่าย:
--   venues = "สนาม" คือสถานที่ (master)
--   courts = "คอร์ต" ที่จองในวันนั้น + จำนวนชั่วโมง (รายวัน, เป็นตัวคูณค่าสนาม)
--
-- ไฟล์นี้เป็น source of truth สำหรับฐานข้อมูลใหม่ — รันทั้งไฟล์ใน SQL editor
-- ============================================================

create extension if not exists "pgcrypto"; -- สำหรับ gen_random_uuid()


-- ============================================================
-- RESET — ลบของเดิมทิ้งก่อน เพื่อให้รันไฟล์นี้ซ้ำได้เรื่อยๆ
-- ------------------------------------------------------------
-- *** ลบข้อมูลทั้งหมดในตารางเหล่านี้ ***
-- มีไว้เพราะถ้าสคริปต์พังกลางทาง จะได้แก้แล้วรันใหม่ตั้งแต่ต้นได้เลย
-- ไม่ต้องตามเก็บว่าคำสั่งไหนผ่านไปแล้วบ้าง
-- ถ้ามีข้อมูลจริงที่ต้องรักษาไว้ ให้ลบ block นี้ออกก่อนรัน
-- (ไม่แตะ schema auth ของ Supabase — บัญชีผู้ใช้ยังอยู่ครบ)
-- ============================================================
drop view if exists
  v_waiting_queue, v_court_board, v_match_history, v_billing_summary,
  v_session_player_stats, v_session_summary, v_pair_history,
  v_club_days, v_member_stats, v_my_clubs, v_club_ranking, v_session_archive cascade;

drop table if exists
  match_players, matches, courts, players, sessions,
  club_access, clubs, members, venues, shuttle_models, shuttle_brands cascade;

-- ลบฟังก์ชันเดิมทุก overload (create or replace ไม่ทับของที่ signature เปลี่ยนไป
-- เช่น add_player เดิมรับ 3 พารามิเตอร์ ตัวใหม่รับ 4 — ของเก่าจะค้างอยู่)
do $reset$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'set_updated_at',
        'can_view_club', 'can_edit_club', 'is_club_owner',
        'can_view_session', 'can_edit_session', 'has_master_access',
        'create_club', 'grant_club_access', 'revoke_club_access', 'list_club_members',
        'last_day_defaults', 'create_play_day', 'start_play_day', 'cancel_play_day',
        'close_session', 'open_session', 'get_or_create_my_session',
        'add_player', 'set_player_attendance', 'resume_player_queue',
        'assign_court', 'start_match', 'substitute_player', 'cancel_match',
        'finish_match', 'remove_court'
      )
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end
$reset$;

-- ---------- helper: auto update updated_at ----------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ============================================================
-- MASTER DATA
-- ============================================================

-- ------------------------------------------------------------
-- clubs — "ก๊วน" คือกลุ่มคนที่ตีด้วยกันประจำ อยู่ถาวร
-- (ต่างจาก sessions ซึ่งคือ "วันเล่น" ครั้งเดียว)
-- ------------------------------------------------------------
create table clubs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) > 0),
  note       text,
  active     boolean not null default true,
  -- ให้ทุกคนในก๊วนเห็นตัวเลข rating ไหม (คนจัดก๊วนเห็นเสมอ)
  show_rating boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_clubs_owner on clubs(owner_id);

create trigger trg_clubs_updated_at
  before update on clubs
  for each row execute function set_updated_at();


-- ------------------------------------------------------------
-- club_access — ใครเข้าถึงก๊วนนี้ได้บ้าง
--   owner  = เจ้าของ แก้ได้ทุกอย่าง ลบก๊วนได้ แชร์ให้คนอื่นได้
--   editor = จัดวันเล่น จับคู่ลงคอร์ตได้ แต่แชร์ต่อไม่ได้
--   viewer = ดูอย่างเดียว
-- เจ้าของก๊วนจะมีแถวที่นี่ role='owner' เสมอ (ใส่ให้ตอน create_club)
-- ------------------------------------------------------------
create table club_access (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

create unique index uq_club_access on club_access(club_id, user_id);
create index idx_club_access_user on club_access(user_id);


-- ------------------------------------------------------------
-- members — รายชื่อผู้เล่น เก็บรวมชุดเดียวต่อผู้ใช้ ไม่แยกตามก๊วน
-- players จะ snapshot ชื่อ/มือของแต่ละวันไว้ต่างหาก
-- เปลี่ยนชื่อสมาชิกทีหลังจึงไม่ทำให้ประวัติเก่าเพี้ยน
-- ------------------------------------------------------------
create table members (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(trim(name)) > 0),
  default_skill smallint not null default 2 check (default_skill between 1 and 3),
  note          text,
  active        boolean not null default true,
  -- ความเก่งที่เรียนรู้จากแต้มจริง (แบบ Elo) — null = ยังไม่มีเกมที่จดแต้ม
  -- ให้ใช้ค่าจากระดับมือแทน (skill_rating) ปรับระดับมือแล้วค่าตามไปด้วยจนกว่าจะเริ่มเล่นจริง
  rating        numeric(7, 2),
  rated_games   int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_members_owner on members(owner_id);

-- ระดับมือ 1–3 -> rating ตั้งต้น (100 แต้ม ≈ ห่างกันหนึ่งระดับมือ)
-- ต้องตรงกับ skillRating() ใน src/utils/pairing.js
create or replace function skill_rating(p_skill int)
returns numeric
language sql
immutable
as $$ select 800 + 100 * p_skill::numeric $$;

create unique index uq_members_owner_name
  on members(owner_id, lower(trim(name)));

create trigger trg_members_updated_at
  before update on members
  for each row execute function set_updated_at();


-- ------------------------------------------------------------
-- venues — สถานที่ที่ไปตี (ไม่ใช่คอร์ต)
-- ตั้งใจไม่เก็บราคาไว้ที่นี่ — ราคาค่าสนามอยู่ที่ sessions.hourly_rate ของแต่ละวัน
-- ที่เดียว มีสองที่แล้วจะสับสนว่าอันไหนคืออันจริง
-- (ฟอร์มสร้างวันเล่น prefill ราคาจากวันล่าสุดของก๊วนนั้นแทน ซึ่งแม่นกว่า)
-- ------------------------------------------------------------
create table venues (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(trim(name)) > 0),
  note        text,
  court_count int not null default 1 check (court_count >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_venues_owner on venues(owner_id);

create unique index uq_venues_owner_name
  on venues(owner_id, lower(trim(name)));

create trigger trg_venues_updated_at
  before update on venues
  for each row execute function set_updated_at();


-- ------------------------------------------------------------
-- shuttle_brands — ยี่ห้อลูกแบด ตั้งใจไม่เก็บราคา
-- ราคาลูกอยู่ที่ sessions.shuttle_price ของแต่ละวัน เพราะราคาเปลี่ยนบ่อย
-- และยอดของวันที่จ่ายไปแล้วต้องไม่ขยับตามราคาใหม่
-- ------------------------------------------------------------
create table shuttle_brands (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) > 0),
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_shuttle_brands_owner on shuttle_brands(owner_id);

create unique index uq_shuttle_brands_owner_name
  on shuttle_brands(owner_id, lower(trim(name)));

create trigger trg_shuttle_brands_updated_at
  before update on shuttle_brands
  for each row execute function set_updated_at();


-- ------------------------------------------------------------
-- shuttle_models — รุ่นของลูกแบด อยู่ใต้ยี่ห้อ
-- แยกตารางเพื่อให้ยี่ห้อเดียวมีหลายรุ่นโดยไม่ต้องพิมพ์ชื่อยี่ห้อซ้ำ
-- และเปลี่ยนชื่อยี่ห้อทีเดียวมีผลกับทุกรุ่น
-- ไม่มี owner_id ของตัวเอง — สิทธิ์ตัดสินผ่านยี่ห้อแม่
-- ------------------------------------------------------------
create table shuttle_models (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references shuttle_brands(id) on delete cascade,
  name       text not null check (char_length(trim(name)) > 0),
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_shuttle_models_brand on shuttle_models(brand_id);

create unique index uq_shuttle_models_brand_name
  on shuttle_models(brand_id, lower(trim(name)));

create trigger trg_shuttle_models_updated_at
  before update on shuttle_models
  for each row execute function set_updated_at();


-- ============================================================
-- ข้อมูลรายวัน
-- ============================================================

-- ------------------------------------------------------------
-- sessions — หนึ่งแถว = "หนึ่งวันเล่น" ของก๊วนหนึ่ง
--   planned   -> จองไว้ล่วงหน้า ยังไม่ถึงวัน แก้ไขได้เต็มที่
--   playing   -> กำลังเล่นอยู่ (มีได้ทีละวันต่อก๊วน)
--   done      -> จบแล้ว ยอดเงิน/สถิติถูก freeze ไว้ใน final_* ไม่คำนวณสดอีก
--   cancelled -> จองไว้แล้วไม่ได้ไป
--
-- venue_name / shuttle_brand_name เก็บ snapshot ไว้ เผื่อ master ถูกลบ
-- (หลักการเดียวกับ matches.court_name และ match_players.player_name)
-- ------------------------------------------------------------
create table sessions (
  id                 uuid primary key default gen_random_uuid(),
  club_id            uuid not null references clubs(id) on delete cascade,

  venue_id           uuid references venues(id) on delete set null,
  venue_name         text,
  shuttle_brand_id   uuid references shuttle_brands(id) on delete set null,
  shuttle_model_id   uuid references shuttle_models(id) on delete set null,
  shuttle_brand_name text,   -- snapshot "ยี่ห้อ รุ่น" รวมกัน ไว้แสดงผลเผื่อ master ถูกลบ

  play_date          date not null,
  start_time         time,
  end_time           time,
  status             text not null default 'planned'
                       check (status in ('planned', 'playing', 'done', 'cancelled')),
  note               text,

  -- ค่าสนาม = ชั่วโมงรวมของทุกคอร์ต (courts.hours) × hourly_rate
  hourly_rate        numeric(10,2) not null default 0 check (hourly_rate >= 0),
  -- ค่าลูก = shuttle_count × shuttle_price
  shuttle_price      numeric(10,2) not null default 0 check (shuttle_price >= 0),
  shuttle_count      int           not null default 0 check (shuttle_count >= 0),

  -- วิธีเลือกผู้เล่นลงคอร์ต — logic จริงอยู่ใน src/utils/pairing.js
  queue_mode         text not null default 'sequential'
                       check (queue_mode in ('sequential', 'rotate')),

  closed_at          timestamptz,
  -- ยอดที่ freeze ไว้ตอนจบวัน (null จนกว่าจะกดจบ)
  final_total_hours   numeric(10,2),
  final_court_total   numeric(12,2),
  final_shuttle_total numeric(12,2),
  final_total_fee     numeric(12,2),
  final_payer_count   int,
  final_per_person    numeric(12,2),
  final_player_count  int,
  final_game_count    int,
  final_play_minutes  int,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_sessions_club_date on sessions(club_id, play_date desc);
create index idx_sessions_club_status on sessions(club_id, status);

-- หนึ่งก๊วนมี "วันที่กำลังเล่น" ได้ทีละวันเดียว
-- (แทนกฎเดิม "1 ผู้ใช้เปิดได้ทีละก๊วน" ซึ่งจำกัดผิดที่)
create unique index uq_one_playing_day_per_club
  on sessions(club_id)
  where status = 'playing';

create trigger trg_sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();


-- ------------------------------------------------------------
-- players — คนที่อยู่ในวันเล่นนั้น (snapshot ชื่อ/มือจาก members)
--   waiting  -> รออยู่ในคิว
--   playing  -> อยู่ในคอร์ตแล้ว (รวมแมตช์ที่ยัง pending ไม่ได้กดเริ่ม)
--   resting  -> พักชั่วคราว ไม่เข้าคิว แต่ยังร่วมจ่าย
--   absent   -> ลงชื่อไว้ล่วงหน้าแต่วันจริงไม่มา ไม่เข้าคิว "และไม่นับเป็นคนหารเงิน"
-- ------------------------------------------------------------
create table players (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  -- null ได้ = แขกขาจรที่ไม่ได้เก็บเป็นสมาชิก
  member_id    uuid references members(id) on delete set null,
  name         text not null check (char_length(trim(name)) > 0),
  skill        smallint not null default 2 check (skill between 1 and 3),
  status       text not null default 'waiting'
                 check (status in ('waiting', 'resting', 'playing', 'absent')),
  games_played int not null default 0 check (games_played >= 0),
  paying       boolean not null default true,
  -- ลำดับคิว: ใช้เลขรัน ไม่ใช่ timestamp เพื่อกันค่าชนกันเวลาเรียง
  queue_seq    bigserial,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_players_session on players(session_id);
create index idx_players_session_status on players(session_id, status);
create index idx_players_member on players(member_id);

-- สมาชิกคนเดิมลงชื่อซ้ำในวันเดียวกันไม่ได้ (แขกที่ member_id null ไม่ถูกจำกัด)
create unique index uq_player_once_per_day
  on players(session_id, member_id)
  where member_id is not null;

create trigger trg_players_updated_at
  before update on players
  for each row execute function set_updated_at();


-- ------------------------------------------------------------
-- courts — คอร์ตที่จองไว้ในวันนั้น 1 แถว = 1 การจอง
-- จอง 2 คอร์ต คอร์ตแรก 3 ชม. คอร์ตสอง 2 ชม. ก็เก็บคนละค่าได้
-- ------------------------------------------------------------
create table courts (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  hours      numeric(5,2) not null default 0 check (hours >= 0),
  created_at timestamptz not null default now()
);

create index idx_courts_session on courts(session_id);


-- ------------------------------------------------------------
-- matches — 1 แถว = 1 เกม
--   pending -> จับคู่แล้วแต่ยังไม่กดเริ่ม (สลับตัวได้ ยังไม่จับเวลา)
--   playing -> กำลังเล่น (started_at เริ่มนับตรงนี้)
--   done    -> จบแล้ว -> กลายเป็นประวัติ
--   ended_at is null ทั้ง pending และ playing = คอร์ตนั้นไม่ว่าง
-- ------------------------------------------------------------
create table matches (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  court_id   uuid references courts(id) on delete set null,
  court_name text not null,  -- snapshot เผื่อคอร์ตถูกลบภายหลัง
  status     text not null default 'pending'
               check (status in ('pending', 'playing', 'done')),
  started_at timestamptz,    -- null ระหว่าง pending
  ended_at   timestamptz,
  -- แต้มไม่บังคับ: ไม่กรอกก็จบเกมได้ เกมนั้นแค่ไม่ถูกนับแพ้/ชนะ
  -- แบดไม่มีเสมอ แต้มเท่ากันจึงไม่ยอม (ไม่งั้นตัดสินผู้ชนะไม่ได้)
  score_a    smallint check (score_a between 0 and 99),
  score_b    smallint check (score_b between 0 and 99),
  created_at timestamptz not null default now(),
  constraint matches_score_both check ((score_a is null) = (score_b is null)),
  constraint matches_score_no_tie check (score_a is null or score_a <> score_b)
);

create index idx_matches_session on matches(session_id);
create index idx_matches_history on matches(session_id, ended_at desc);
create index idx_matches_status on matches(session_id, status);

-- กันไม่ให้คอร์ตเดียวมีแมตช์ที่ยังไม่จบ (pending หรือ playing) เกิน 1 เกม
create unique index uq_one_active_match_per_court
  on matches(court_id)
  where ended_at is null;


-- ------------------------------------------------------------
-- match_players — ผู้เล่นแต่ละคนในแต่ละแมตช์ + ทีม
-- เก็บ snapshot ชื่อ/มือ ประวัติจึงอยู่รอดแม้ผู้เล่นถูกลบ
-- ------------------------------------------------------------
create table match_players (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references matches(id) on delete cascade,
  player_id   uuid references players(id) on delete set null,
  player_name text not null,
  skill       smallint not null check (skill between 1 and 3),
  team        text not null check (team in ('A', 'B')),
  -- rating ที่เกมนี้ให้/หักคนนี้ (null = ไม่ได้คิด: ไม่จดแต้ม แขก หรือเกมสั้นผิดปกติ)
  -- เก็บไว้เพื่อถอนออกตอนแก้แต้มย้อนหลัง
  rating_delta numeric(6, 2),
  created_at  timestamptz not null default now()
);

create index idx_match_players_match on match_players(match_id);
create index idx_match_players_player on match_players(player_id);

create unique index uq_match_player_once
  on match_players(match_id, player_id)
  where player_id is not null;


-- ============================================================
-- Helper: ตรวจสิทธิ์
-- ------------------------------------------------------------
-- ทุกตัวเป็น SECURITY DEFINER จึงอ่าน club_access ได้โดยไม่ติด RLS
-- ของตัวเอง — จำเป็น ไม่งั้น policy ของ club_access จะวนซ้ำไม่รู้จบ
-- ============================================================

create or replace function can_view_club(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_access
    where club_id = p_club_id and user_id = auth.uid()
  );
$$;

create or replace function can_edit_club(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_access
    where club_id = p_club_id and user_id = auth.uid()
      and role in ('owner', 'editor')
  );
$$;

create or replace function is_club_owner(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_access
    where club_id = p_club_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function can_view_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sessions s
    join club_access a on a.club_id = s.club_id
    where s.id = p_session_id and a.user_id = auth.uid()
  );
$$;

create or replace function can_edit_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sessions s
    join club_access a on a.club_id = s.club_id
    where s.id = p_session_id and a.user_id = auth.uid()
      and a.role in ('owner', 'editor')
  );
$$;

-- master ของใครคนหนึ่ง: เจ้าตัวแก้ได้ ส่วนคนที่ถูกแชร์ก๊วนของเขามาจะอ่านได้
-- (ต้องอ่านได้ ไม่งั้นเลือกผู้เล่น/สนาม ตอนจัดวันเล่นไม่ได้)
create or replace function has_master_access(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner_id = auth.uid() or exists (
    select 1 from clubs c
    join club_access a on a.club_id = c.id
    where c.owner_id = p_owner_id and a.user_id = auth.uid()
  );
$$;

-- แก้ข้อมูลหลักของ p_owner_id ได้ไหม — ต้องมีบทบาท owner/editor ในก๊วนของเขา
-- (viewer อ่านได้อย่างเดียว ส่วนสิทธิ์ "ลบ" สงวนไว้ให้เจ้าของคนเดียว)
create or replace function has_master_edit_access(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner_id = auth.uid() or exists (
    select 1 from clubs c
    join club_access a on a.club_id = c.id
    where c.owner_id = p_owner_id
      and a.user_id = auth.uid()
      and a.role in ('owner', 'editor')
  );
$$;

grant execute on function can_view_club(uuid)     to authenticated;
grant execute on function can_edit_club(uuid)     to authenticated;
grant execute on function is_club_owner(uuid)     to authenticated;
grant execute on function can_view_session(uuid)  to authenticated;
grant execute on function can_edit_session(uuid)  to authenticated;
grant execute on function has_master_access(uuid) to authenticated;
grant execute on function has_master_edit_access(uuid) to authenticated;


-- ------------------------------------------------------------
-- กันผู้ร่วมจัดก๊วนยึดข้อมูลหลักของเจ้าของไปเป็นของตัวเอง
--
-- policy "shared can update ..." เช็ค has_master_edit_access ทั้ง USING และ
-- WITH CHECK — USING เช็คแถวเดิม (ผ่านเพราะเป็น editor) ส่วน WITH CHECK
-- เช็คแถวใหม่ ถ้าสั่ง SET owner_id = ตัวเอง ก็ยังผ่าน เพราะฟังก์ชันคืน true
-- ให้ตัวเองเสมอ RLS อ้าง OLD ใน WITH CHECK ไม่ได้ จึงต้องกันด้วย trigger
-- ------------------------------------------------------------
create or replace function lock_master_owner()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'เปลี่ยนเจ้าของข้อมูลหลักไม่ได้';
  end if;
  return new;
end;
$$;

create trigger trg_members_lock_owner
  before update on members for each row execute function lock_master_owner();
create trigger trg_venues_lock_owner
  before update on venues for each row execute function lock_master_owner();
create trigger trg_shuttle_brands_lock_owner
  before update on shuttle_brands for each row execute function lock_master_owner();

-- shuttle_models ไม่มี owner_id แต่ย้าย brand_id ไปยี่ห้อตัวเองได้ = ยึดแบบเดียวกัน
create or replace function lock_model_brand()
returns trigger language plpgsql as $$
begin
  if new.brand_id is distinct from old.brand_id then
    raise exception 'ย้ายรุ่นไปยี่ห้ออื่นไม่ได้';
  end if;
  return new;
end;
$$;

create trigger trg_shuttle_models_lock_brand
  before update on shuttle_models for each row execute function lock_model_brand();


-- ============================================================
-- Views
-- ============================================================

-- ประวัติการแข่งขัน พร้อมชื่อผู้เล่นสองทีม
create or replace view v_match_history as
select
  m.id,
  m.session_id,
  m.court_name,
  m.started_at,
  m.ended_at,
  m.score_a,
  m.score_b,
  array_agg(mp.player_name) filter (where mp.team = 'A') as team_a_names,
  array_agg(mp.player_name) filter (where mp.team = 'B') as team_b_names
from matches m
join match_players mp on mp.match_id = m.id
where m.ended_at is not null
group by m.id
order by m.ended_at desc;

-- สรุปค่าใช้จ่ายต่อคนของวันเล่น
-- หารเท่ากันทุกคนที่ "มา" และร่วมจ่าย — ไม่หารตามจำนวนเกมหรือนาที
-- คนที่ status = 'absent' ไม่ถูกนับเป็นตัวหาร (ลงชื่อไว้แต่ไม่ได้มา)
create or replace view v_billing_summary as
with court_totals as (
  select session_id, coalesce(sum(hours), 0) as total_hours
  from courts
  group by session_id
),
payer_totals as (
  select session_id, count(*) filter (where paying and status <> 'absent') as payer_count
  from players
  group by session_id
)
select
  s.id as session_id,
  s.hourly_rate,
  coalesce(c.total_hours, 0)                           as total_hours,
  round(coalesce(c.total_hours, 0) * s.hourly_rate, 2) as court_total,
  s.shuttle_count,
  s.shuttle_price,
  round(s.shuttle_count * s.shuttle_price, 2)          as shuttle_total,
  round(coalesce(c.total_hours, 0) * s.hourly_rate + s.shuttle_count * s.shuttle_price, 2) as total_fee,
  coalesce(p.payer_count, 0) as payer_count,
  case
    when coalesce(p.payer_count, 0) > 0
      then round(
        (coalesce(c.total_hours, 0) * s.hourly_rate + s.shuttle_count * s.shuttle_price)
        / p.payer_count, 2)
    else 0
  end as per_person
from sessions s
left join court_totals c on c.session_id = s.id
left join payer_totals p on p.session_id = s.id;

-- สถิติรายคนในวันเล่น: กี่เกม กี่นาที (นับเฉพาะแมตช์ที่จบแล้ว)
-- คนที่ถูกสลับตัวออกก่อนเริ่มไม่มีแถวใน match_players จึงไม่ถูกนับเอง
create or replace view v_session_player_stats as
select
  p.id         as player_id,
  p.session_id,
  p.name,
  p.status,
  p.paying,
  count(m.id)                                                           as games,
  coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60 as minutes,
  -- แพ้/ชนะนับเฉพาะเกมที่กรอกแต้ม (ฝั่งเราแต้มมากกว่า = ชนะ)
  count(m.id) filter (where m.score_a is not null and (mp.team = 'A') =  (m.score_a > m.score_b)) as wins,
  count(m.id) filter (where m.score_a is not null and (mp.team = 'A') <> (m.score_a > m.score_b)) as losses,
  coalesce(sum(case when mp.team = 'A' then m.score_a - m.score_b else m.score_b - m.score_a end)
           filter (where m.score_a is not null), 0) as point_diff,
  -- พักครบหนึ่งเกมแล้วหรือยัง: หลังจบเกมล่าสุดของเรา ต้องมีเกมอื่นที่จับคู่
  -- หลังจากนั้นและเล่นจบไปแล้วหนึ่งเกม (ยังไม่เคยเล่น = พักครบ)
  max(m.ended_at) is null or exists (
    select 1 from matches m2
    where m2.session_id = p.session_id and m2.status = 'done' and m2.created_at > max(m.ended_at)
  ) as rested
from players p
left join match_players mp on mp.player_id = p.id
left join matches m
  on m.id = mp.match_id
 and m.status = 'done'
 and m.started_at is not null
group by p.id;

-- สรุปภาพรวมของวันเล่น (player_count นับเฉพาะคนที่มาจริง)
create or replace view v_session_summary as
select
  s.id as session_id,
  (select count(*) from players p where p.session_id = s.id and p.status <> 'absent') as player_count,
  (select count(*) from players p where p.session_id = s.id and p.status =  'absent') as absent_count,
  (select count(*) from courts c where c.session_id = s.id)                  as court_count,
  (select coalesce(sum(c.hours), 0) from courts c where c.session_id = s.id) as booked_hours,
  (select count(*) from matches m where m.session_id = s.id and m.status = 'done') as finished_games,
  (select coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60
     from matches m
    where m.session_id = s.id and m.status = 'done' and m.started_at is not null) as total_play_minutes
from sessions s;

-- ประวัติการเจอกันของผู้เล่นแต่ละคู่ — ใช้โดยโหมดคิว 'rotate'
-- เก็บคู่ละแถวเดียว โดยให้ player_a < player_b เสมอ
create or replace view v_pair_history as
select
  m.session_id,
  a.player_id as player_a,
  b.player_id as player_b,
  count(*) filter (where a.team =  b.team) as together_count,
  count(*) filter (where a.team <> b.team) as against_count
from match_players a
join match_players b
  on b.match_id = a.match_id
 and a.player_id < b.player_id
join matches m on m.id = a.match_id
where m.status = 'done'
group by m.session_id, a.player_id, b.player_id;

-- รายการวันเล่นของก๊วน — ใช้ทั้งหน้า "ที่จะเล่น" และ "ที่เล่นไปแล้ว"
-- วันที่จบแล้วอ่านยอดจาก final_* เท่านั้น ไม่คำนวณสดซ้ำ
-- (ถ้าคำนวณสด พอแก้เรทค่าสนามทีหลัง ยอดของวันเก่าจะเปลี่ยนตามทั้งที่จ่ายกันไปแล้ว)
create or replace view v_club_days as
select
  s.id as session_id,
  s.club_id,
  s.play_date,
  s.start_time,
  s.end_time,
  s.status,
  s.venue_name,
  s.shuttle_brand_name,
  s.closed_at,
  case when s.status = 'done' then s.final_total_fee    else b.total_fee    end as total_fee,
  case when s.status = 'done' then s.final_per_person   else b.per_person   end as per_person,
  case when s.status = 'done' then s.final_total_hours  else b.total_hours  end as total_hours,
  case when s.status = 'done' then s.final_player_count else sm.player_count end as player_count,
  case when s.status = 'done' then s.final_game_count   else sm.finished_games end as game_count,
  case when s.status = 'done' then s.final_play_minutes else round(sm.total_play_minutes) end as play_minutes
from sessions s
left join v_billing_summary b on b.session_id = s.id
left join v_session_summary sm on sm.session_id = s.id
order by s.play_date desc, s.created_at desc;

-- สถิติสมาชิกข้ามทุกก๊วน (นับเฉพาะวันที่จบแล้ว และเฉพาะวันที่มาจริง)
create or replace view v_member_stats as
select
  mb.id      as member_id,
  mb.owner_id,
  mb.name,
  mb.default_skill,
  mb.note,
  mb.active,
  -- นับเฉพาะวันที่ join ติด (s.status = 'done') ไม่ใช่ทุกวันที่ลงชื่อไว้
  count(distinct s.id)                                      as days_played,
  coalesce(sum(p.games_played) filter (where s.id is not null), 0) as total_games,
  (
    select round(coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60)
    from players p2
    join match_players mp on mp.player_id = p2.id
    join matches m on m.id = mp.match_id and m.status = 'done' and m.started_at is not null
    where p2.member_id = mb.id
  ) as total_minutes,
  max(s.play_date) as last_played_on
from members mb
left join players p on p.member_id = mb.id and p.status <> 'absent'
left join sessions s on s.id = p.session_id and s.status = 'done'
group by mb.id;

-- อันดับแพ้/ชนะของก๊วน รวมทุกวันเล่น นับเฉพาะเกมที่กรอกแต้ม
-- ผูกกับสมาชิก (member_id) ข้ามวันได้ แขกขาจรไม่มี member จึงไม่ติดอันดับ
-- ชื่อใช้ชื่อปัจจุบันในรายชื่อหลัก เปลี่ยนชื่อแล้วอันดับยังเป็นคนเดิม
create or replace view v_club_ranking as
select
  s.club_id,
  mb.id   as member_id,
  mb.name,
  coalesce(mb.rating, skill_rating(mb.default_skill)) as rating,
  mb.rated_games,
  count(*)                                                        as games,
  count(*) filter (where (mp.team = 'A') =  (m.score_a > m.score_b)) as wins,
  count(*) filter (where (mp.team = 'A') <> (m.score_a > m.score_b)) as losses,
  sum(case when mp.team = 'A' then m.score_a - m.score_b else m.score_b - m.score_a end) as point_diff
from match_players mp
join matches m  on m.id = mp.match_id and m.status = 'done' and m.score_a is not null
join sessions s on s.id = m.session_id
join players p  on p.id = mp.player_id
join members mb on mb.id = p.member_id
group by s.club_id, mb.id, mb.name, mb.rating, mb.default_skill, mb.rated_games;

-- ก๊วนที่ฉันเข้าถึงได้ พร้อมบทบาทและวันเล่นล่าสุด/ถัดไป
create or replace view v_my_clubs as
select
  c.id,
  c.owner_id,
  c.name,
  c.note,
  c.active,
  c.created_at,
  a.role,
  (c.owner_id = auth.uid()) as is_mine,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'done')    as done_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'planned')   as planned_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'cancelled') as cancelled_days,
  (select count(*) from sessions s where s.club_id = c.id)                            as total_days,
  (select s.id from sessions s where s.club_id = c.id and s.status = 'playing' limit 1) as playing_session_id,
  (select max(s.play_date) from sessions s where s.club_id = c.id and s.status = 'done') as last_played_on,
  (select min(s.play_date) from sessions s
    where s.club_id = c.id and s.status = 'planned' and s.play_date >= current_date) as next_play_date,
  c.show_rating
from clubs c
join club_access a on a.club_id = c.id and a.user_id = auth.uid();

-- หมายเหตุ: รายชื่อ "คนที่แชร์ก๊วนด้วยกัน" พร้อมอีเมล ทำเป็น view ไม่ได้
-- เพราะ security_invoker จะทำให้ต้องมีสิทธิ์อ่าน auth.users ซึ่ง role
-- authenticated ไม่มี — ใช้ RPC list_club_members() ใน functions.sql แทน

-- view รันด้วยสิทธิ์เจ้าของ view เป็นค่าเริ่มต้น ซึ่งข้าม RLS
-- เปิด security_invoker ให้ใช้สิทธิ์ของคนเรียกแทน RLS จึงมีผลจริง
-- *** view ใหม่ทุกตัวต้องตั้งค่านี้เสมอ ***
alter view v_match_history        set (security_invoker = on);
alter view v_billing_summary      set (security_invoker = on);
alter view v_session_player_stats set (security_invoker = on);
alter view v_session_summary      set (security_invoker = on);
alter view v_pair_history         set (security_invoker = on);
alter view v_club_days            set (security_invoker = on);
alter view v_member_stats         set (security_invoker = on);
alter view v_club_ranking         set (security_invoker = on);
alter view v_my_clubs             set (security_invoker = on);


-- ============================================================
-- Row Level Security
-- ------------------------------------------------------------
-- ข้อมูลรายวันทุกตารางตัดสินสิทธิ์ผ่าน club_access ไม่ใช่ owner_id ตรงๆ
-- เพราะก๊วนแชร์ให้คนอื่นดู/แก้ได้
-- ============================================================
alter table clubs          enable row level security;
alter table club_access    enable row level security;
alter table members        enable row level security;
alter table venues         enable row level security;
alter table shuttle_brands enable row level security;
alter table shuttle_models enable row level security;
alter table sessions       enable row level security;
alter table players        enable row level security;
alter table courts         enable row level security;
alter table matches        enable row level security;
alter table match_players  enable row level security;

-- ---------- clubs ----------
create policy "view accessible clubs" on clubs
  for select using (can_view_club(id));

-- ตั้งใจไม่มี policy insert: สร้างก๊วนต้องผ่าน create_club() เท่านั้น
-- ถ้า insert ตรงๆ ได้ จะเกิดก๊วนที่ไม่มีแถวใน club_access = เจ้าของเองก็มองไม่เห็น

create policy "owner updates club" on clubs
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner deletes club" on clubs
  for delete using (owner_id = auth.uid());

-- ---------- club_access ----------
-- เห็นแถวของตัวเอง หรือทุกแถวถ้าเป็นเจ้าของก๊วน
create policy "view club access" on club_access
  for select using (user_id = auth.uid() or is_club_owner(club_id));

-- เพิ่ม/ลบคนเข้าก๊วนทำผ่าน RPC เท่านั้น (grant_club_access / revoke_club_access)
-- แต่เปิดให้เจ้าของลบได้ตรงๆ เผื่อจัดการจากหน้าตั้งค่า
create policy "owner removes club access" on club_access
  for delete using (is_club_owner(club_id) and user_id <> auth.uid());

-- ---------- master ----------
-- เจ้าของ: ทำได้ทุกอย่างรวมถึงลบ
-- คนที่ถูกแชร์ก๊วนมาเป็น owner/editor: อ่าน เพิ่ม และแก้ได้ แต่ "ลบไม่ได้"
--   (ลบแล้วกู้ไม่ได้ และกระทบทุกก๊วนของเจ้าของ ไม่ใช่แค่ก๊วนที่เขาดูแล)
-- viewer: อ่านอย่างเดียว
create policy "manage own members" on members
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "shared can read members" on members
  for select using (has_master_access(owner_id));

create policy "shared can add members" on members
  for insert with check (has_master_edit_access(owner_id));

create policy "shared can update members" on members
  for update using (has_master_edit_access(owner_id))
  with check (has_master_edit_access(owner_id));

create policy "manage own venues" on venues
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "shared can read venues" on venues
  for select using (has_master_access(owner_id));

create policy "shared can add venues" on venues
  for insert with check (has_master_edit_access(owner_id));

create policy "shared can update venues" on venues
  for update using (has_master_edit_access(owner_id))
  with check (has_master_edit_access(owner_id));

create policy "manage own shuttle brands" on shuttle_brands
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "shared can read shuttle brands" on shuttle_brands
  for select using (has_master_access(owner_id));

create policy "shared can add shuttle brands" on shuttle_brands
  for insert with check (has_master_edit_access(owner_id));

create policy "shared can update shuttle brands" on shuttle_brands
  for update using (has_master_edit_access(owner_id))
  with check (has_master_edit_access(owner_id));

-- shuttle_models ไม่มี owner_id ของตัวเอง ตัดสินสิทธิ์ผ่านยี่ห้อแม่
create policy "manage own shuttle models" on shuttle_models
  for all
  using (exists (
    select 1 from shuttle_brands b where b.id = brand_id and b.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from shuttle_brands b where b.id = brand_id and b.owner_id = auth.uid()
  ));

create policy "shared can read shuttle models" on shuttle_models
  for select
  using (exists (
    select 1 from shuttle_brands b where b.id = brand_id and has_master_access(b.owner_id)
  ));

create policy "shared can add shuttle models" on shuttle_models
  for insert
  with check (exists (
    select 1 from shuttle_brands b where b.id = brand_id and has_master_edit_access(b.owner_id)
  ));

create policy "shared can update shuttle models" on shuttle_models
  for update
  using (exists (
    select 1 from shuttle_brands b where b.id = brand_id and has_master_edit_access(b.owner_id)
  ))
  with check (exists (
    select 1 from shuttle_brands b where b.id = brand_id and has_master_edit_access(b.owner_id)
  ));

-- ---------- รายวัน ----------
create policy "view club sessions" on sessions
  for select using (can_view_club(club_id));

create policy "edit club sessions" on sessions
  for insert with check (can_edit_club(club_id));

create policy "update club sessions" on sessions
  for update using (can_edit_club(club_id)) with check (can_edit_club(club_id));

create policy "delete club sessions" on sessions
  for delete using (can_edit_club(club_id));

create policy "view players" on players
  for select using (can_view_session(session_id));

create policy "edit players" on players
  for all using (can_edit_session(session_id)) with check (can_edit_session(session_id));

create policy "view courts" on courts
  for select using (can_view_session(session_id));

create policy "edit courts" on courts
  for all using (can_edit_session(session_id)) with check (can_edit_session(session_id));

create policy "view matches" on matches
  for select using (can_view_session(session_id));

create policy "edit matches" on matches
  for all using (can_edit_session(session_id)) with check (can_edit_session(session_id));

create policy "view match players" on match_players
  for select using (
    exists (select 1 from matches m where m.id = match_id and can_view_session(m.session_id))
  );

create policy "edit match players" on match_players
  for all using (
    exists (select 1 from matches m where m.id = match_id and can_edit_session(m.session_id))
  )
  with check (
    exists (select 1 from matches m where m.id = match_id and can_edit_session(m.session_id))
  );


-- ============================================================
-- (ต้องทำ) เปิด Realtime ใน Dashboard เพื่อให้หลายอุปกรณ์เห็นตรงกัน
-- ============================================================
-- alter publication supabase_realtime add table players, courts, matches, match_players, sessions;

-- ฝั่งแอป subscribe แบบมี filter (session_id=eq.…) ซึ่ง payload ของ DELETE
-- ตามค่าเริ่มต้นมีแค่คีย์หลัก ไม่มี session_id ให้ filter เทียบ event ลบจึงหาย
-- replica identity full ส่งค่าทุกคอลัมน์ของแถวที่ถูกลบมาด้วย
alter table players replica identity full;
alter table courts replica identity full;
alter table matches replica identity full;
