-- ============================================================
-- 005 — ปิดก๊วน / เปิดก๊วนใหม่ + รายชื่อสมาชิก (master ผู้เล่น)
-- ------------------------------------------------------------
-- เดิม: 1 ผู้ใช้ = 1 ก๊วนถาวร นับเกม/เวลา/ค่าใช้จ่ายสะสมไปเรื่อย ๆ
-- ใหม่: 1 ก๊วน = 1 ครั้งที่ไปตี ปิดแล้วเปิดใหม่ได้ ตัวเลขเริ่มนับใหม่
--
-- สองเรื่องที่มาคู่กันเสมอ:
--   1. ปิดก๊วน = freeze ยอดเงิน/สถิติของครั้งนั้นไว้ ไม่คำนวณสดอีก
--      เพราะถ้าคำนวณสดจากเรทปัจจุบัน พอสนามขึ้นราคา ประวัติเก่าจะ
--      เปลี่ยนยอดตามไปด้วย ทั้งที่วันนั้นจ่ายกันไปแล้วจริง ๆ
--      (หลักการเดียวกับ match_players.player_name ที่ snapshot ไว้)
--   2. members = ตัวตนของคนข้ามครั้ง ทำให้เปิดก๊วนใหม่แล้วติ๊กเลือก
--      รายชื่อเดิมได้ ไม่ต้องพิมพ์ใหม่ และดูสถิติข้ามครั้งได้
--
-- รันไฟล์นี้ใน Supabase SQL editor ต่อจาก 004
-- ============================================================

-- ------------------------------------------------------------
-- 1. ปิดก๊วนได้ + ที่เก็บยอดที่ freeze ไว้
-- ------------------------------------------------------------
alter table sessions
  add column if not exists closed_at          timestamptz,
  add column if not exists final_total_hours  numeric(10,2),
  add column if not exists final_court_total  numeric(12,2),
  add column if not exists final_shuttle_total numeric(12,2),
  add column if not exists final_total_fee    numeric(12,2),
  add column if not exists final_payer_count  int,
  add column if not exists final_per_person   numeric(12,2),
  add column if not exists final_player_count int,
  add column if not exists final_game_count   int,
  add column if not exists final_play_minutes int;

create index if not exists idx_sessions_owner_open
  on sessions(owner_id, closed_at);


-- ------------------------------------------------------------
-- 2. members — ตัวตนของผู้เล่น ใช้ข้ามก๊วน
--    players ยังเก็บ snapshot ชื่อ/สกิลของครั้งนั้นไว้เหมือนเดิม
--    (เปลี่ยนชื่อสมาชิกทีหลัง ประวัติเก่าจะไม่เพี้ยน)
-- ------------------------------------------------------------
create table if not exists members (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(trim(name)) > 0),
  default_skill smallint not null default 2 check (default_skill between 1 and 3),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_members_owner on members(owner_id);

-- ชื่อซ้ำในก๊วนเดียวกันไม่ควรมี — ใช้เทียบแบบไม่สนตัวพิมพ์
create unique index if not exists uq_members_owner_name
  on members(owner_id, lower(trim(name)));

drop trigger if exists trg_members_updated_at on members;
create trigger trg_members_updated_at
  before update on members
  for each row execute function set_updated_at();

alter table members enable row level security;

drop policy if exists "owner can manage own members" on members;
create policy "owner can manage own members"
  on members for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());


-- ------------------------------------------------------------
-- 3. ผูก players เข้ากับ members
--    null ได้ = แขกขาจรที่ไม่อยากเก็บเป็นสมาชิก
--    on delete set null = ลบสมาชิกแล้วประวัติเก่ายังอยู่ครบ
-- ------------------------------------------------------------
alter table players
  add column if not exists member_id uuid references members(id) on delete set null;

create index if not exists idx_players_member on players(member_id);


-- ------------------------------------------------------------
-- 4. ย้ายข้อมูลเดิม: ผู้เล่นที่มีอยู่แล้วกลายเป็นสมาชิกอัตโนมัติ
-- ------------------------------------------------------------
insert into members (owner_id, name, default_skill)
select distinct on (s.owner_id, lower(trim(p.name)))
  s.owner_id, trim(p.name), p.skill
from players p
join sessions s on s.id = p.session_id
order by s.owner_id, lower(trim(p.name)), p.created_at
on conflict do nothing;

update players p
set member_id = m.id
from sessions s, members m
where p.session_id = s.id
  and m.owner_id = s.owner_id
  and lower(trim(m.name)) = lower(trim(p.name))
  and p.member_id is null;


-- ============================================================
-- get_or_create_my_session — เอาเฉพาะก๊วนที่ยังเปิดอยู่
-- ก๊วนที่ปิดแล้วจะไม่ถูกหยิบกลับมา ถ้าไม่มีก๊วนเปิดอยู่จะสร้างใหม่ให้
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


-- ------------------------------------------------------------
-- เพิ่มผู้เล่นเข้าก๊วน — สร้าง/อัปเดตสมาชิกให้อัตโนมัติไปในตัว
-- ทำให้รายชื่อสมาชิกสะสมขึ้นมาเองโดยไม่ต้องมีหน้าจัดการแยก
-- ------------------------------------------------------------
create or replace function add_player(
  p_session_id uuid,
  p_name text,
  p_skill smallint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_member_id uuid;
  v_player_id uuid;
  v_name text := trim(p_name);
begin
  select s.owner_id into v_owner_id
  from sessions s
  where s.id = p_session_id and s.owner_id = auth.uid() and s.closed_at is null;

  if v_owner_id is null then
    raise exception 'session not found, access denied, or already closed';
  end if;

  if char_length(v_name) = 0 then
    raise exception 'ต้องใส่ชื่อผู้เล่น';
  end if;

  insert into members (owner_id, name, default_skill)
  values (v_owner_id, v_name, p_skill)
  on conflict (owner_id, lower(trim(name)))
    do update set default_skill = excluded.default_skill
  returning id into v_member_id;

  insert into players (session_id, member_id, name, skill)
  values (p_session_id, v_member_id, v_name, p_skill)
  returning id into v_player_id;

  return v_player_id;
end;
$$;


-- ------------------------------------------------------------
-- ปิดก๊วน: freeze ยอดเงินและสถิติของครั้งนั้นไว้ถาวร
-- ต้องไม่มีเกมค้างอยู่ (จบหรือยกเลิกให้หมดก่อน)
-- ------------------------------------------------------------
create or replace function close_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_sum  record;
begin
  if not exists (
    select 1 from sessions
    where id = p_session_id and owner_id = auth.uid() and closed_at is null
  ) then
    raise exception 'session not found, access denied, or already closed';
  end if;

  if exists (
    select 1 from matches
    where session_id = p_session_id and status in ('pending', 'playing')
  ) then
    raise exception 'ยังมีเกมค้างอยู่ในคอร์ต ต้องจบเกมหรือยกเลิกให้หมดก่อนปิดก๊วน';
  end if;

  select * into v_bill from v_billing_summary where session_id = p_session_id;
  select * into v_sum  from v_session_summary where session_id = p_session_id;

  update sessions
  set closed_at           = now(),
      final_total_hours   = coalesce(v_bill.total_hours, 0),
      final_court_total   = coalesce(v_bill.court_total, 0),
      final_shuttle_total = coalesce(v_bill.shuttle_total, 0),
      final_total_fee     = coalesce(v_bill.total_fee, 0),
      final_payer_count   = coalesce(v_bill.payer_count, 0),
      final_per_person    = coalesce(v_bill.per_person, 0),
      final_player_count  = coalesce(v_sum.player_count, 0),
      final_game_count    = coalesce(v_sum.finished_games, 0),
      final_play_minutes  = round(coalesce(v_sum.total_play_minutes, 0))
  where id = p_session_id;
end;
$$;


-- ------------------------------------------------------------
-- เปิดก๊วนใหม่ พร้อมดึงสมาชิกที่เลือกเข้ามาเป็นผู้เล่นเลย
-- ค่าเรทและโหมดคิวสืบทอดจากก๊วนล่าสุด (ปกติสนามเดิมราคาเดิม)
-- ------------------------------------------------------------
create or replace function open_session(
  p_name text default null,
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_prev record;
begin
  if exists (
    select 1 from sessions where owner_id = auth.uid() and closed_at is null
  ) then
    raise exception 'ยังมีก๊วนที่เปิดอยู่ ต้องปิดก๊วนปัจจุบันก่อน';
  end if;

  select hourly_rate, shuttle_price, queue_mode into v_prev
  from sessions
  where owner_id = auth.uid()
  order by created_at desc
  limit 1;

  insert into sessions (owner_id, name, hourly_rate, shuttle_price, queue_mode)
  values (
    auth.uid(),
    coalesce(nullif(trim(p_name), ''), 'ก๊วน ' || to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY')),
    coalesce(v_prev.hourly_rate, 0),
    coalesce(v_prev.shuttle_price, 0),
    coalesce(v_prev.queue_mode, 'sequential')
  )
  returning id into v_session_id;

  insert into courts (session_id, name, sort_order)
  values (v_session_id, 'คอร์ต 1', 0);

  -- ดึงสมาชิกที่ติ๊กเลือกมาเป็นผู้เล่น พร้อม snapshot ชื่อ/สกิลของครั้งนี้
  insert into players (session_id, member_id, name, skill)
  select v_session_id, m.id, m.name, m.default_skill
  from members m
  where m.owner_id = auth.uid() and m.id = any(p_member_ids);

  return v_session_id;
end;
$$;


-- ============================================================
-- Views
-- ============================================================

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

-- สถิติสมาชิกข้ามทุกก๊วน — สิ่งที่ทำไม่ได้เลยตอนยังมีก๊วนเดียว
create or replace view v_member_stats as
select
  mb.id           as member_id,
  mb.owner_id,
  mb.name,
  mb.default_skill,
  mb.active,
  count(distinct p.session_id)                                         as sessions_played,
  coalesce(sum(p.games_played), 0)                                     as total_games,
  (
    select round(coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60)
    from players p2
    join match_players mp on mp.player_id = p2.id
    join matches m on m.id = mp.match_id and m.status = 'done' and m.started_at is not null
    where p2.member_id = mb.id
  )                                                                    as total_minutes,
  max(s.created_at)                                                    as last_played_at
from members mb
left join players p on p.member_id = mb.id
left join sessions s on s.id = p.session_id
group by mb.id;

alter view v_session_archive set (security_invoker = on);
alter view v_member_stats    set (security_invoker = on);


grant execute on function add_player(uuid, text, smallint) to authenticated;
grant execute on function close_session(uuid) to authenticated;
grant execute on function open_session(text, uuid[]) to authenticated;
