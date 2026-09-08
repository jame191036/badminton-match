-- ============================================================
-- Badminton Queue & Court Management — Supabase Schema
-- แปลงจาก state เดิม (players / courts / history / billing ใน
-- localStorage) ให้เป็นตารางเชิงสัมพันธ์ รองรับหลายก๊วน + Supabase Auth
-- ============================================================

create extension if not exists "pgcrypto"; -- สำหรับ gen_random_uuid()

-- ---------- helper: auto update updated_at ----------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ============================================================
-- 1. sessions  — หนึ่งแถว = หนึ่ง "ก๊วน" (รองรับหลายก๊วน/ผู้ใช้)
-- ============================================================
create table sessions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null default 'ก๊วนแบด',
  court_fee     numeric(10,2) not null default 0 check (court_fee >= 0),
  shuttle_fee   numeric(10,2) not null default 0 check (shuttle_fee >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();


-- ============================================================
-- 2. players  — แทน state `players` เดิม
-- ============================================================
create table players (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  name          text not null check (char_length(trim(name)) > 0),
  skill         smallint not null default 2 check (skill between 1 and 3),
  status        text not null default 'waiting'
                  check (status in ('waiting', 'resting', 'playing')),
  games_played  int not null default 0 check (games_played >= 0),
  paying        boolean not null default true,
  -- แทน queuedAt เดิม: ใช้เลขรันแทน timestamp เพื่อกันชนกันเวลาเรียงคิว
  queue_seq     bigserial,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_players_session on players(session_id);
create index idx_players_session_status on players(session_id, status);

create trigger trg_players_updated_at
  before update on players
  for each row execute function set_updated_at();


-- ============================================================
-- 3. courts  — แทน state `courts` เดิม
-- ============================================================
create table courts (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_courts_session on courts(session_id);


-- ============================================================
-- 4. matches — 1 แถว = 1 เกม
--    ended_at IS NULL  -> เกมกำลังเล่นอยู่ (คือ court.match ปัจจุบัน)
--    ended_at NOT NULL -> จบแล้ว -> กลายเป็นประวัติ (MatchHistory)
-- ============================================================
create table matches (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  court_id      uuid references courts(id) on delete set null,
  court_name    text not null,  -- snapshot ชื่อคอร์ต เผื่อคอร์ตถูกลบภายหลัง
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_matches_session on matches(session_id);
create index idx_matches_history on matches(session_id, ended_at desc);

-- กันไม่ให้คอร์ตเดียวมีแมตช์ "กำลังเล่น" พร้อมกันเกิน 1 เกม
create unique index uq_one_active_match_per_court
  on matches(court_id)
  where ended_at is null;


-- ============================================================
-- 5. match_players — junction: ผู้เล่นแต่ละคนในแต่ละแมตช์ + ทีม
--    เก็บ snapshot ชื่อ/สกิล ไว้ด้วย เผื่อผู้เล่นถูกลบภายหลัง
--    ประวัติการแข่งขันจะยังแสดงชื่อได้ครบเหมือนเดิม
-- ============================================================
create table match_players (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  player_id     uuid references players(id) on delete set null,
  player_name   text not null,
  skill         smallint not null check (skill between 1 and 3),
  team          text not null check (team in ('A', 'B')),
  created_at    timestamptz not null default now()
);

create index idx_match_players_match on match_players(match_id);
create index idx_match_players_player on match_players(player_id);

-- ผู้เล่นคนเดียวกันลงซ้ำในแมตช์เดียวกันไม่ได้
create unique index uq_match_player_once
  on match_players(match_id, player_id)
  where player_id is not null;


-- ============================================================
-- Views — ให้ตรงกับ logic เดิมใน pairing.js / component ต่างๆ
-- ============================================================

-- คิวรอลงคอร์ต: เรียงตาม games_played แล้ว queue_seq (เหมือน pickNextMatch)
create or replace view v_waiting_queue as
select *
from players
where status = 'waiting'
order by session_id, games_played, queue_seq;

-- สถานะคอร์ต + แมตช์ที่กำลังเล่นอยู่ (ถ้ามี) — แทน CourtBoard
create or replace view v_court_board as
select
  c.id            as court_id,
  c.session_id,
  c.name          as court_name,
  c.sort_order,
  m.id            as match_id,
  m.started_at
from courts c
left join matches m
  on m.court_id = c.id and m.ended_at is null
order by c.session_id, c.sort_order;

-- ประวัติการแข่งขัน พร้อมชื่อผู้เล่นสองทีม — แทน MatchHistory
create or replace view v_match_history as
select
  m.id,
  m.session_id,
  m.court_name,
  m.started_at,
  m.ended_at,
  array_agg(mp.player_name) filter (where mp.team = 'A') as team_a_names,
  array_agg(mp.player_name) filter (where mp.team = 'B') as team_b_names
from matches m
join match_players mp on mp.match_id = m.id
where m.ended_at is not null
group by m.id
order by m.ended_at desc;

-- สรุปค่าใช้จ่ายต่อคน — แทน BillingPanel
create or replace view v_billing_summary as
select
  s.id as session_id,
  s.court_fee,
  s.shuttle_fee,
  (s.court_fee + s.shuttle_fee) as total_fee,
  count(p.id) filter (where p.paying) as payer_count,
  case
    when count(p.id) filter (where p.paying) > 0
      then round((s.court_fee + s.shuttle_fee) / count(p.id) filter (where p.paying), 2)
    else 0
  end as per_person
from sessions s
left join players p on p.session_id = s.id
group by s.id;


-- ============================================================
-- Row Level Security — เห็น/แก้ได้เฉพาะก๊วนของตัวเอง
-- (ถ้าไม่ต้องการระบบ auth/หลายผู้ใช้ ลบ block นี้ทิ้งได้เลย)
-- ============================================================
alter table sessions enable row level security;
alter table players enable row level security;
alter table courts enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;

create policy "owner can manage own sessions"
  on sessions for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owner can manage own players"
  on players for all
  using (session_id in (select id from sessions where owner_id = auth.uid()))
  with check (session_id in (select id from sessions where owner_id = auth.uid()));

create policy "owner can manage own courts"
  on courts for all
  using (session_id in (select id from sessions where owner_id = auth.uid()))
  with check (session_id in (select id from sessions where owner_id = auth.uid()));

create policy "owner can manage own matches"
  on matches for all
  using (session_id in (select id from sessions where owner_id = auth.uid()))
  with check (session_id in (select id from sessions where owner_id = auth.uid()));

create policy "owner can manage own match_players"
  on match_players for all
  using (match_id in (
    select m.id from matches m
    join sessions s on s.id = m.session_id
    where s.owner_id = auth.uid()
  ))
  with check (match_id in (
    select m.id from matches m
    join sessions s on s.id = m.session_id
    where s.owner_id = auth.uid()
  ));


-- ============================================================
-- (แนะนำ) เปิด Realtime เพื่อให้หลายอุปกรณ์เห็นคิว/คอร์ตอัปเดตพร้อมกัน
-- ============================================================
-- alter publication supabase_realtime add table players, courts, matches, match_players;


-- ============================================================
-- get_or_create_my_session()
-- ------------------------------------------------------------
-- ตอนนี้ต้องการ "1 ก๊วนต่อ 1 ผู้ใช้" ไปก่อน แต่ตารางออกแบบให้รองรับ
-- หลายก๊วนต่อผู้ใช้ได้อยู่แล้วในอนาคต (ไม่ต้อง migrate ใหม่)
--
-- ฝั่งแอป: เรียกฟังก์ชันนี้ครั้งเดียวหลัง login เพื่อขอ session_id
-- มาใช้งาน — ถ้ายังไม่มีก๊วนของ user นี้ จะสร้างให้อัตโนมัติ
-- (วันหน้าจะรองรับหลายก๊วน แค่เลิกเรียกฟังก์ชันนี้ แล้วให้ผู้ใช้
-- เลือก/สร้างก๊วนเองจาก UI แทน)
-- ============================================================
create or replace function get_or_create_my_session()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  select id into v_session_id
  from sessions
  where owner_id = auth.uid()
  order by created_at asc
  limit 1;

  if v_session_id is null then
    insert into sessions (owner_id)
    values (auth.uid())
    returning id into v_session_id;
  end if;

  return v_session_id;
end;
$$;
