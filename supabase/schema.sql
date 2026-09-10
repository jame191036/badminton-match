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
-- 0. members — ตัวตนของผู้เล่น ใช้ข้ามก๊วน (master data)
--    players จะ snapshot ชื่อ/สกิลของแต่ละครั้งไว้ต่างหาก
--    เปลี่ยนชื่อสมาชิกทีหลังจึงไม่ทำให้ประวัติเก่าเพี้ยน
-- ============================================================
create table members (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(trim(name)) > 0),
  default_skill smallint not null default 2 check (default_skill between 1 and 3),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_members_owner on members(owner_id);

create unique index uq_members_owner_name
  on members(owner_id, lower(trim(name)));

create trigger trg_members_updated_at
  before update on members
  for each row execute function set_updated_at();


-- ============================================================
-- 1. sessions  — หนึ่งแถว = หนึ่ง "ก๊วน" (หนึ่งครั้งที่ไปตี)
--    closed_at is null = ก๊วนที่กำลังเล่นอยู่ (มีได้ทีละอันต่อผู้ใช้)
--    ปิดแล้วยอดเงิน/สถิติจะถูก freeze ไว้ในคอลัมน์ final_* ไม่คำนวณสดอีก
-- ============================================================
create table sessions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null default 'ก๊วนแบด',
  -- ค่าสนาม = ชั่วโมงรวมของทุกคอร์ต (courts.hours) × hourly_rate
  hourly_rate   numeric(10,2) not null default 0 check (hourly_rate >= 0),
  -- ค่าลูก = shuttle_count × shuttle_price
  shuttle_price numeric(10,2) not null default 0 check (shuttle_price >= 0),
  shuttle_count int           not null default 0 check (shuttle_count >= 0),
  -- วิธีเลือกผู้เล่นลงคอร์ต — logic จริงอยู่ใน src/utils/pairing.js
  queue_mode    text not null default 'sequential'
                  check (queue_mode in ('sequential', 'rotate')),
  closed_at     timestamptz,
  -- ยอดที่ freeze ไว้ตอนปิดก๊วน (null ระหว่างที่ยังเปิดอยู่)
  final_total_hours   numeric(10,2),
  final_court_total   numeric(12,2),
  final_shuttle_total numeric(12,2),
  final_total_fee     numeric(12,2),
  final_payer_count   int,
  final_per_person    numeric(12,2),
  final_player_count  int,
  final_game_count    int,
  final_play_minutes  int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_sessions_owner_open on sessions(owner_id, closed_at);

create trigger trg_sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();


-- ============================================================
-- 2. players  — แทน state `players` เดิม
-- ============================================================
create table players (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  -- null ได้ = แขกขาจรที่ไม่ได้เก็บเป็นสมาชิก
  member_id     uuid references members(id) on delete set null,
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
create index idx_players_member on players(member_id);

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
  -- 1 แถวคอร์ต = 1 การจอง จึงเก็บชั่วโมงที่จองไว้ที่นี่
  -- (จอง 2 สนาม สนามแรก 3 ชม. สนามสอง 2 ชม. ก็เก็บคนละค่าได้)
  hours         numeric(5,2) not null default 0 check (hours >= 0),
  created_at    timestamptz not null default now()
);

create index idx_courts_session on courts(session_id);


-- ============================================================
-- 4. matches — 1 แถว = 1 เกม
--    pending -> จับคู่แล้วแต่ยังไม่กดเริ่ม (สลับตัวได้ ยังไม่จับเวลา)
--    playing -> กำลังเล่น (started_at เริ่มนับตรงนี้)
--    done    -> จบแล้ว -> กลายเป็นประวัติ (MatchHistory)
--    ended_at IS NULL ทั้ง pending และ playing = คอร์ตนั้นไม่ว่าง
-- ============================================================
create table matches (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  court_id      uuid references courts(id) on delete set null,
  court_name    text not null,  -- snapshot ชื่อคอร์ต เผื่อคอร์ตถูกลบภายหลัง
  status        text not null default 'pending'
                  check (status in ('pending', 'playing', 'done')),
  started_at    timestamptz,    -- null ระหว่าง pending
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_matches_session on matches(session_id);
create index idx_matches_history on matches(session_id, ended_at desc);
create index idx_matches_status on matches(session_id, status);

-- กันไม่ให้คอร์ตเดียวมีแมตช์ที่ยังไม่จบ (pending หรือ playing) เกิน 1 เกม
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
  m.status        as match_status,
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
-- ยอดรวมมาจากชั่วโมงจริงของแต่ละคอร์ต + จำนวนลูกที่ใช้
-- แต่ยังหารเท่ากันทุกคนที่ร่วมจ่าย (ไม่หารตามจำนวนเกม)
create or replace view v_billing_summary as
with court_totals as (
  select session_id, coalesce(sum(hours), 0) as total_hours
  from courts
  group by session_id
),
payer_totals as (
  select session_id, count(*) filter (where paying) as payer_count
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

-- สถิติรายคนในก๊วน: เล่นกี่เกม กี่นาที (นับเฉพาะแมตช์ที่จบแล้ว)
-- คนที่ถูกสลับตัวออกก่อนเริ่มไม่มีแถวใน match_players จึงไม่ถูกนับเอง
create or replace view v_session_player_stats as
select
  p.id                as player_id,
  p.session_id,
  p.name,
  p.status,
  p.paying,
  count(m.id)                                                          as games,
  coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60 as minutes
from players p
left join match_players mp on mp.player_id = p.id
left join matches m
  on m.id = mp.match_id
 and m.status = 'done'
 and m.started_at is not null
group by p.id;

-- สรุปภาพรวมของก๊วน
create or replace view v_session_summary as
select
  s.id as session_id,
  (select count(*) from players p where p.session_id = s.id)               as player_count,
  (select count(*) from courts c where c.session_id = s.id)                as court_count,
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

-- รายการก๊วนที่ปิดไปแล้ว พร้อมยอดที่ freeze ไว้ (ไม่คำนวณสดใหม่)
create or replace view v_session_archive as
select
  s.id,
  s.owner_id,
  s.name,
  s.created_at,
  s.closed_at,
  s.final_total_hours,
  s.final_court_total,
  s.final_shuttle_total,
  s.final_total_fee,
  s.final_payer_count,
  s.final_per_person,
  s.final_player_count,
  s.final_game_count,
  s.final_play_minutes
from sessions s
where s.closed_at is not null
order by s.closed_at desc;

-- สถิติสมาชิกข้ามทุกก๊วน
create or replace view v_member_stats as
select
  mb.id           as member_id,
  mb.owner_id,
  mb.name,
  mb.default_skill,
  mb.active,
  count(distinct p.session_id)     as sessions_played,
  coalesce(sum(p.games_played), 0) as total_games,
  (
    select round(coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60)
    from players p2
    join match_players mp on mp.player_id = p2.id
    join matches m on m.id = mp.match_id and m.status = 'done' and m.started_at is not null
    where p2.member_id = mb.id
  )                                as total_minutes,
  max(s.created_at)                as last_played_at
from members mb
left join players p on p.member_id = mb.id
left join sessions s on s.id = p.session_id
group by mb.id;

-- view รันด้วยสิทธิ์เจ้าของ view เป็นค่าเริ่มต้น ซึ่งข้าม RLS
-- เปิด security_invoker ให้ใช้สิทธิ์ของคนเรียกแทน RLS จึงมีผลจริง
alter view v_waiting_queue          set (security_invoker = on);
alter view v_court_board            set (security_invoker = on);
alter view v_match_history          set (security_invoker = on);
alter view v_billing_summary        set (security_invoker = on);
alter view v_session_player_stats   set (security_invoker = on);
alter view v_session_summary        set (security_invoker = on);
alter view v_pair_history           set (security_invoker = on);
alter view v_session_archive        set (security_invoker = on);
alter view v_member_stats           set (security_invoker = on);


-- ============================================================
-- Row Level Security — เห็น/แก้ได้เฉพาะก๊วนของตัวเอง
-- (ถ้าไม่ต้องการระบบ auth/หลายผู้ใช้ ลบ block นี้ทิ้งได้เลย)
-- ============================================================
alter table members enable row level security;
alter table sessions enable row level security;
alter table players enable row level security;
alter table courts enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;

create policy "owner can manage own members"
  on members for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

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
-- คืน session_id ของก๊วนที่ "ยังเปิดอยู่" (closed_at is null)
-- ถ้าไม่มีจะสร้างใหม่พร้อมคอร์ตแรกให้เลย
-- ก๊วนที่ปิดแล้วจะไม่ถูกหยิบกลับมา — ดูย้อนหลังผ่าน v_session_archive
--
-- ฝั่งแอป: เรียกครั้งเดียวหลัง login และเรียกซ้ำหลังปิด/เปิดก๊วน
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
  where owner_id = auth.uid() and closed_at is null
  order by created_at desc
  limit 1;

  if v_session_id is null then
    insert into sessions (owner_id)
    values (auth.uid())
    returning id into v_session_id;

    insert into courts (session_id, name, sort_order)
    values (v_session_id, 'คอร์ต 1', 0);
  end if;

  return v_session_id;
end;
$$;
