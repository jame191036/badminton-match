-- ============================================================
-- 121 — เลือกวิธีหารเงินเองได้ + เอาฟีเจอร์เก็บเงิน/ค้างจ่ายออก
-- ------------------------------------------------------------
-- เพิ่ม:
--   sessions.split_mode   วิธีหารยอดรวม คนจัดเลือกเองต่อวัน (ค่าเริ่มต้น equal = แบบเดิม)
--     equal  หารเท่ากันทุกคนที่มาและร่วมจ่าย
--     games  หารทั้งก้อนตามสัดส่วนเกม: คนละ = รวม × เกมของคนนั้น ÷ เกมรวมของผู้ร่วมจ่าย
--     สูตรอยู่ฝั่งแอป (src/utils/billing.js splitShares) SQL เก็บแค่ว่าเลือกแบบไหน
--   trigger กันเปลี่ยนวิธีหารของวันที่จบแล้ว (ยอดรายคนจะขยับทั้งที่จ่ายกันไปแล้ว)
--   last_day_defaults / create_play_day / update_play_day รับและจำวิธีหาร
--     (เปลี่ยน signature: ลบตัวเก่าก่อน ไม่งั้น PostgREST เลือกไม่ถูกว่าเรียกตัวไหน)
--   v_club_days.split_mode · per_person เป็น null เมื่อหารตามเกม (แต่ละคนจ่ายไม่เท่ากัน)
--
-- เอาออก:
--   v_club_outstanding  แท็บค้างจ่ายของก๊วน (แท็บเก็บเงิน/พร้อมเพย์ก็เอาออกจากแอปแล้ว)
--
-- *** ไม่ลบข้อมูลใด ๆ *** players.paid_at และ clubs.promptpay_id / promptpay_name
-- ยังอยู่ในฐานข้อมูลครบ แค่แอปไม่ได้ใช้แล้ว (ผู้ใช้เลือกเก็บไว้ เผื่อเอาฟีเจอร์กลับมา)
-- วันเล่นเดิมทุกวันได้ split_mode = 'equal' ยอดทุกวันจึงเหมือนเดิมทุกบาท
--
-- รันซ้ำได้ · ทั้งไฟล์อยู่ใน transaction เดียว
-- ============================================================

begin;

alter table sessions add column if not exists
split_mode         text not null default 'equal'
                       check (split_mode in ('equal', 'games'));

-- วันที่จบแล้วเปลี่ยนวิธีหารไม่ได้ — ยอดรายคนของวันนั้นคิดจาก final_total_fee ที่ล็อกไว้
-- กับวิธีหารนี้ ถ้าสลับวิธีทีหลัง ยอดรายคนจะเปลี่ยนทั้งที่จ่ายกันไปแล้ว
create or replace function lock_closed_day_split()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'done' and new.split_mode is distinct from old.split_mode then
    raise exception 'วันเล่นนี้จบแล้ว เปลี่ยนวิธีหารเงินไม่ได้';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sessions_lock_closed_split on sessions;

create trigger trg_sessions_lock_closed_split
  before update on sessions
  for each row execute function lock_closed_day_split();

create or replace function last_day_defaults(p_club_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last sessions%rowtype;
begin
  if not can_view_club(p_club_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงก๊วนนี้';
  end if;

  select * into v_last
  from sessions
  where club_id = p_club_id and status in ('done', 'playing')
  order by play_date desc, created_at desc
  limit 1;

  if v_last.id is null then
    return json_build_object('found', false);
  end if;

  return json_build_object(
    'found', true,
    'session_id', v_last.id,
    'venue_id', v_last.venue_id,
    'shuttle_brand_id', v_last.shuttle_brand_id,
    'shuttle_model_id', v_last.shuttle_model_id,
    'start_time', v_last.start_time,
    'end_time', v_last.end_time,
    'hourly_rate', v_last.hourly_rate,
    'shuttle_price', v_last.shuttle_price,
    'queue_mode', v_last.queue_mode,
    'force_rest', v_last.force_rest,
    'split_mode', v_last.split_mode,
    'courts', (
      select coalesce(json_agg(json_build_object('name', c.name, 'hours', c.hours)
                               order by c.sort_order), '[]'::json)
      from courts c where c.session_id = v_last.id
    ),
    'member_ids', (
      select coalesce(json_agg(p.member_id), '[]'::json)
      from players p
      where p.session_id = v_last.id and p.member_id is not null and p.status <> 'absent'
    )
  );
end;
$$;

-- ตัวเก่าก่อนมี p_split_mode (121) — ค้างไว้สองตัว PostgREST จะเลือกไม่ถูกว่าเรียกตัวไหน
drop function if exists create_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text, boolean);

create or replace function create_play_day(
  p_club_id uuid,
  p_play_date date,
  p_start_time time default null,
  p_end_time time default null,
  p_venue_id uuid default null,
  p_shuttle_brand_id uuid default null,
  p_shuttle_model_id uuid default null,
  p_hourly_rate numeric default null,
  p_shuttle_price numeric default null,
  p_shuttle_count int default 0,
  p_queue_mode text default 'sequential',
  p_member_ids uuid[] default '{}',
  p_courts jsonb default null,
  p_note text default null,
  p_force_rest boolean default true,
  p_split_mode text default 'equal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_session_id uuid;
  v_venue_name text;
  v_brand_name text;
  v_model_name text;
  v_court_count int := 0;
begin
  if not can_edit_club(p_club_id) then
    raise exception 'ไม่มีสิทธิ์จัดวันเล่นของก๊วนนี้';
  end if;

  if p_play_date is null then
    raise exception 'ต้องเลือกวันที่';
  end if;

  select owner_id into v_owner_id from clubs where id = p_club_id;

  if p_venue_id is not null then
    select name into v_venue_name
    from venues where id = p_venue_id and owner_id = v_owner_id;
    if v_venue_name is null then
      raise exception 'ไม่พบสนามที่เลือก';
    end if;
  end if;

  if p_shuttle_brand_id is not null then
    select name into v_brand_name
    from shuttle_brands where id = p_shuttle_brand_id and owner_id = v_owner_id;
    if v_brand_name is null then
      raise exception 'ไม่พบยี่ห้อลูกแบดที่เลือก';
    end if;
  end if;

  -- รุ่นต้องเป็นของยี่ห้อที่เลือกจริงๆ กันส่ง id มั่วมาจากฝั่ง client
  if p_shuttle_model_id is not null then
    select m.name into v_model_name
    from shuttle_models m
    join shuttle_brands b on b.id = m.brand_id
    where m.id = p_shuttle_model_id
      and b.owner_id = v_owner_id
      and m.brand_id = p_shuttle_brand_id;
    if v_model_name is null then
      raise exception 'รุ่นที่เลือกไม่ได้อยู่ใต้ยี่ห้อนี้';
    end if;
  end if;

  insert into sessions (
    club_id, venue_id, venue_name,
    shuttle_brand_id, shuttle_model_id, shuttle_brand_name,
    play_date, start_time, end_time, status,
    hourly_rate, shuttle_price, shuttle_count, queue_mode, force_rest, split_mode, note
  )
  values (
    p_club_id, p_venue_id, v_venue_name,
    p_shuttle_brand_id, p_shuttle_model_id,
    -- snapshot เป็นข้อความเดียว "ยี่ห้อ รุ่น" ไว้แสดงผลเผื่อ master ถูกลบ
    nullif(trim(coalesce(v_brand_name, '') || ' ' || coalesce(v_model_name, '')), ''),
    p_play_date, p_start_time, p_end_time, 'planned',
    coalesce(p_hourly_rate, 0),
    coalesce(p_shuttle_price, 0),
    coalesce(p_shuttle_count, 0),
    coalesce(p_queue_mode, 'sequential'),
    coalesce(p_force_rest, true),
    coalesce(p_split_mode, 'equal'),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_session_id;

  -- คอร์ตที่จอง
  if p_courts is not null and jsonb_typeof(p_courts) = 'array' then
    insert into courts (session_id, name, hours, sort_order)
    select
      v_session_id,
      coalesce(nullif(trim(c.value ->> 'name'), ''), 'คอร์ต ' || (c.ordinality)::text),
      coalesce((c.value ->> 'hours')::numeric, 0),
      (c.ordinality - 1)::int
    from jsonb_array_elements(p_courts) with ordinality as c(value, ordinality);

    get diagnostics v_court_count = row_count;
  end if;

  -- ไม่ได้ระบุคอร์ตมาเลย ให้มีคอร์ตแรกไว้ก่อนหนึ่งคอร์ต
  if v_court_count = 0 then
    insert into courts (session_id, name, sort_order) values (v_session_id, 'คอร์ต 1', 0);
  end if;

  -- ผู้เล่นที่เลือกไว้ล่วงหน้า (snapshot ชื่อ/มือ ณ ตอนนี้)
  --
  -- เริ่มที่ resting ไม่ใช่ waiting: ตอนสร้างวันเป็นการ "จองรายชื่อ" คนยังไม่มา
  -- คนจัดก๊วนกดชื่อทีละคนเข้าคิวเมื่อมาถึง (แถบ "พักอยู่" บนแท็บคอร์ต)
  -- ถ้าเริ่มที่ waiting ระบบจะจับคนที่ยังไม่มาลงคอร์ตได้
  --
  -- ต่างจาก add_player ที่ยังเป็น waiting — คนที่พิมพ์ชื่อเพิ่มหน้างานคือคนที่มาแล้ว
  insert into players (session_id, member_id, name, skill, status)
  select v_session_id, m.id, m.name, m.default_skill, 'resting'
  from members m
  where m.owner_id = v_owner_id and m.id = any(p_member_ids)
  on conflict do nothing;

  return v_session_id;
end;
$$;

drop function if exists update_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, jsonb, text, boolean);

create or replace function update_play_day(
  p_session_id uuid,
  p_play_date date,
  p_start_time time default null,
  p_end_time time default null,
  p_venue_id uuid default null,
  p_shuttle_brand_id uuid default null,
  p_shuttle_model_id uuid default null,
  p_hourly_rate numeric default null,
  p_shuttle_price numeric default null,
  p_shuttle_count int default 0,
  p_queue_mode text default 'sequential',
  p_courts jsonb default null,
  p_note text default null,
  p_force_rest boolean default true,
  p_split_mode text default 'equal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_venue_name text;
  v_brand_name text;
  v_model_name text;
  v_court_count int := 0;
begin
  if not can_edit_session(p_session_id) then
    raise exception 'ไม่พบวันเล่นนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  if not exists (select 1 from sessions where id = p_session_id and status = 'planned') then
    raise exception 'แก้ได้เฉพาะวันที่ยังไม่เริ่มเล่นเท่านั้น';
  end if;

  if p_play_date is null then
    raise exception 'ต้องเลือกวันที่';
  end if;

  select c.owner_id into v_owner_id
  from sessions s join clubs c on c.id = s.club_id
  where s.id = p_session_id;

  if p_venue_id is not null then
    select name into v_venue_name
    from venues where id = p_venue_id and owner_id = v_owner_id;
    if v_venue_name is null then
      raise exception 'ไม่พบสนามที่เลือก';
    end if;
  end if;

  if p_shuttle_brand_id is not null then
    select name into v_brand_name
    from shuttle_brands where id = p_shuttle_brand_id and owner_id = v_owner_id;
    if v_brand_name is null then
      raise exception 'ไม่พบยี่ห้อลูกแบดที่เลือก';
    end if;
  end if;

  if p_shuttle_model_id is not null then
    select m.name into v_model_name
    from shuttle_models m
    join shuttle_brands b on b.id = m.brand_id
    where m.id = p_shuttle_model_id
      and b.owner_id = v_owner_id
      and m.brand_id = p_shuttle_brand_id;
    if v_model_name is null then
      raise exception 'รุ่นที่เลือกไม่ได้อยู่ใต้ยี่ห้อนี้';
    end if;
  end if;

  update sessions
  set venue_id           = p_venue_id,
      venue_name         = v_venue_name,
      shuttle_brand_id   = p_shuttle_brand_id,
      shuttle_model_id   = p_shuttle_model_id,
      shuttle_brand_name = nullif(trim(coalesce(v_brand_name, '') || ' ' || coalesce(v_model_name, '')), ''),
      play_date          = p_play_date,
      start_time         = p_start_time,
      end_time           = p_end_time,
      hourly_rate        = coalesce(p_hourly_rate, 0),
      shuttle_price      = coalesce(p_shuttle_price, 0),
      shuttle_count      = coalesce(p_shuttle_count, 0),
      queue_mode         = coalesce(p_queue_mode, 'sequential'),
      force_rest         = coalesce(p_force_rest, true),
      split_mode         = coalesce(p_split_mode, 'equal'),
      note               = nullif(trim(coalesce(p_note, '')), '')
  where id = p_session_id;

  -- คอร์ตเขียนทับทั้งชุด ปลอดภัยเพราะวันที่ยัง planned ยังไม่มีเกมไหนอ้างถึง
  -- (matches ถูกสร้างหลังกด "เริ่มวันเล่น" เท่านั้น)
  if p_courts is not null and jsonb_typeof(p_courts) = 'array' then
    delete from courts where session_id = p_session_id;

    insert into courts (session_id, name, hours, sort_order)
    select
      p_session_id,
      coalesce(nullif(trim(c.value ->> 'name'), ''), 'คอร์ต ' || (c.ordinality)::text),
      coalesce((c.value ->> 'hours')::numeric, 0),
      (c.ordinality - 1)::int
    from jsonb_array_elements(p_courts) with ordinality as c(value, ordinality);

    get diagnostics v_court_count = row_count;

    if v_court_count = 0 then
      insert into courts (session_id, name, sort_order) values (p_session_id, 'คอร์ต 1', 0);
    end if;
  end if;
end;
$$;

grant execute on function create_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text, boolean, text) to authenticated;
grant execute on function update_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, jsonb, text, boolean, text) to authenticated;

-- รายการวันเล่นของก๊วน: per_person เป็น null เมื่อหารตามเกม + คอลัมน์ split_mode ต่อท้าย
-- (create or replace view เพิ่มคอลัมน์ได้แค่ท้ายสุด)
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
  -- หารตามเกม = แต่ละคนจ่ายไม่เท่ากัน ไม่มี "คนละ" ตัวเดียว (null — หน้าจอเขียนว่า "ตามเกม")
  case when s.split_mode = 'games' then null
       when s.status = 'done' then s.final_per_person   else b.per_person   end as per_person,
  case when s.status = 'done' then s.final_total_hours  else b.total_hours  end as total_hours,
  case when s.status = 'done' then s.final_player_count else sm.player_count end as player_count,
  case when s.status = 'done' then s.final_game_count   else sm.finished_games end as game_count,
  case when s.status = 'done' then s.final_play_minutes else round(sm.total_play_minutes) end as play_minutes,
  s.split_mode
from sessions s
left join v_billing_summary b on b.session_id = s.id
left join v_session_summary sm on sm.session_id = s.id
order by s.play_date desc, s.created_at desc;

-- view ที่สร้างใหม่ต้องเปิด security_invoker ทุกตัว ไม่งั้น RLS ไม่มีผล
alter view v_club_days set (security_invoker = on);

drop view if exists v_club_outstanding;

commit;
