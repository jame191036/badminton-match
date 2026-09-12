-- ============================================================
-- 103 — แยก "รุ่น" ออกเป็นตารางของตัวเอง ใต้ยี่ห้อ
-- ------------------------------------------------------------
-- เดิม (101) เก็บรุ่นเป็นคอลัมน์ในแถวเดียวกับยี่ห้อ ทำให้ "RSL Classic"
-- กับ "RSL Tourney" เป็นสองแถวที่ไม่รู้จักกัน — ต้องพิมพ์ RSL ซ้ำ
-- และเปลี่ยนชื่อยี่ห้อทีต้องไล่แก้ทุกแถว
--
-- ใหม่: shuttle_brands (ยี่ห้อ) 1 แถว -> shuttle_models (รุ่น) หลายแถว
--
-- ไฟล์นี้ย้ายข้อมูลเดิมให้ด้วย ไม่ลบทิ้ง:
--   ยี่ห้อชื่อซ้ำกันจะถูกยุบเหลือแถวเดียว (เอาแถวที่สร้างก่อนสุด)
--   ค่า model ของแต่ละแถวกลายเป็นรุ่นใต้ยี่ห้อนั้น
--   วันเล่นเก่าถูกชี้ไปยังยี่ห้อที่ยุบแล้ว และยังมี snapshot ชื่อเดิมอยู่ครบ
-- ============================================================

-- ------------------------------------------------------------
-- 1. ตารางรุ่น
-- ------------------------------------------------------------
create table if not exists shuttle_models (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references shuttle_brands(id) on delete cascade,
  name       text not null check (char_length(trim(name)) > 0),
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shuttle_models_brand on shuttle_models(brand_id);

create unique index if not exists uq_shuttle_models_brand_name
  on shuttle_models(brand_id, lower(trim(name)));

drop trigger if exists trg_shuttle_models_updated_at on shuttle_models;
create trigger trg_shuttle_models_updated_at
  before update on shuttle_models
  for each row execute function set_updated_at();


-- ------------------------------------------------------------
-- 2. ย้ายข้อมูลเดิม
-- ------------------------------------------------------------
-- คอลัมน์ชั่วคราว: แต่ละแถวชี้ไปยัง "แถวที่จะเก็บไว้" ของยี่ห้อชื่อเดียวกัน
alter table shuttle_brands add column if not exists _canon_id uuid;

update shuttle_brands b
set _canon_id = (
  select bb.id
  from shuttle_brands bb
  where bb.owner_id = b.owner_id
    and lower(trim(bb.name)) = lower(trim(b.name))
  order by bb.created_at, bb.id::text
  limit 1
);

-- model เดิมของแต่ละแถว -> รุ่นใต้ยี่ห้อที่เก็บไว้
insert into shuttle_models (brand_id, name, note)
select b._canon_id, trim(b.model), b.note
from shuttle_brands b
where b.model is not null and trim(b.model) <> ''
on conflict (brand_id, lower(trim(name))) do nothing;

-- วันเล่นเก่าที่ชี้ไปยังแถวที่กำลังจะถูกยุบ ให้ย้ายมาชี้แถวที่เก็บไว้
update sessions s
set shuttle_brand_id = b._canon_id
from shuttle_brands b
where s.shuttle_brand_id = b.id and b._canon_id <> b.id;

-- ลบแถวยี่ห้อซ้ำทิ้ง (รุ่นถูกย้ายออกไปแล้ว)
delete from shuttle_brands b
where b._canon_id is not null and b._canon_id <> b.id;

alter table shuttle_brands drop column _canon_id;
alter table shuttle_brands drop column if exists model;

-- unique index กลับมาเป็นแค่ (เจ้าของ + ชื่อยี่ห้อ) เหมือนก่อน 101
drop index if exists uq_shuttle_brands_owner_name;
create unique index uq_shuttle_brands_owner_name
  on shuttle_brands(owner_id, lower(trim(name)));


-- ------------------------------------------------------------
-- 3. วันเล่นจำรุ่นที่ใช้ด้วย
-- ------------------------------------------------------------
alter table sessions
  add column if not exists shuttle_model_id uuid references shuttle_models(id) on delete set null;


-- ------------------------------------------------------------
-- 4. RLS — shuttle_models ไม่มี owner_id ของตัวเอง ตัดสินสิทธิ์ผ่านยี่ห้อแม่
-- ------------------------------------------------------------
alter table shuttle_models enable row level security;

drop policy if exists "manage own shuttle models" on shuttle_models;
create policy "manage own shuttle models" on shuttle_models
  for all
  using (exists (
    select 1 from shuttle_brands b
    where b.id = brand_id and b.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from shuttle_brands b
    where b.id = brand_id and b.owner_id = auth.uid()
  ));

-- คนที่ถูกแชร์ก๊วนมาต้องอ่านได้ ไม่งั้นเลือกรุ่นตอนจัดวันเล่นไม่ได้
drop policy if exists "shared can read shuttle models" on shuttle_models;
create policy "shared can read shuttle models" on shuttle_models
  for select
  using (exists (
    select 1 from shuttle_brands b
    where b.id = brand_id and has_master_access(b.owner_id)
  ));


-- ------------------------------------------------------------
-- 5. create_play_day รับ p_shuttle_model_id เพิ่ม
-- ------------------------------------------------------------
-- signature เปลี่ยน (เพิ่มพารามิเตอร์) create or replace จึงไม่ทับของเดิม
-- ต้อง drop ตัวเก่าทิ้งก่อน ไม่งั้นจะมีสองตัวแล้ว PostgREST เลือกไม่ถูก
drop function if exists create_play_day(uuid, date, time, time, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text);

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
  p_note text default null
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
    hourly_rate, shuttle_price, shuttle_count, queue_mode, note
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
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_session_id;

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

  if v_court_count = 0 then
    insert into courts (session_id, name, sort_order) values (v_session_id, 'คอร์ต 1', 0);
  end if;

  insert into players (session_id, member_id, name, skill)
  select v_session_id, m.id, m.name, m.default_skill
  from members m
  where m.owner_id = v_owner_id and m.id = any(p_member_ids)
  on conflict do nothing;

  return v_session_id;
end;
$$;

grant execute on function create_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text) to authenticated;


-- ------------------------------------------------------------
-- 6. last_day_defaults ส่ง shuttle_model_id กลับไปด้วย
-- ------------------------------------------------------------
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

grant execute on function last_day_defaults(uuid) to authenticated;
