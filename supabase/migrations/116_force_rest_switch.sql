-- ============================================================
-- 116 — แยก "บังคับพัก" ออกจากโหมดคิว เป็นสวิตช์ของตัวเอง
-- ------------------------------------------------------------
-- เดิมการบังคับพักซ่อนอยู่ในชื่อโหมด: rotate = บังคับพัก, fair = ไม่บังคับ
-- ซึ่งอธิบายให้คนในก๊วนเข้าใจไม่ได้ว่าสองโหมดต่างกันตรงไหน ทั้งที่ตรรกะ
-- ต่างกันแค่ตัวกรองเดียว และทั้งคู่เอาจำนวนเกมมาก่อนเหมือนกัน
--
-- ตอนนี้: queue_mode เหลือ 2 ค่า (ดูประวัติคู่หรือไม่)
--         force_rest เป็น boolean แยก (บังคับพัก 1 เกมหรือไม่)
-- ได้ 4 แบบจาก 2 ปุ่ม รวมแบบที่เดิมเลือกไม่ได้คือ ตามลำดับคิว+ไม่บังคับพัก
--
-- ต้องรันหลัง 115 (ซึ่งเพิ่มค่า fair เข้า constraint ไปแล้ว)
-- ============================================================

alter table sessions add column if not exists force_rest boolean not null default true;

-- ย้ายค่าเดิม: fair คือ rotate ที่ปิดบังคับพัก
update sessions set queue_mode = 'rotate', force_rest = false where queue_mode = 'fair';

-- constraint กลับมาเหลือสองค่า (ไล่หาชื่อเองเหมือน 115 ไม่เดา)
do $fix$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.sessions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%queue_mode%'
  loop
    execute format('alter table sessions drop constraint %I', r.conname);
  end loop;
end
$fix$;

alter table sessions add constraint sessions_queue_mode_check
  check (queue_mode in ('sequential', 'rotate'));

-- RPC รับพารามิเตอร์เพิ่ม = signature ใหม่ ต้องลบตัวเก่าทิ้งก่อน
-- ไม่งั้นจะมีสอง overload แล้ว PostgREST เลือกไม่ถูก (ปัญหาเดียวกับ add_player)
drop function if exists create_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text);
drop function if exists update_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, jsonb, text);


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
  p_force_rest boolean default true
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
    hourly_rate, shuttle_price, shuttle_count, queue_mode, force_rest, note
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
  insert into players (session_id, member_id, name, skill)
  select v_session_id, m.id, m.name, m.default_skill
  from members m
  where m.owner_id = v_owner_id and m.id = any(p_member_ids)
  on conflict do nothing;

  return v_session_id;
end;
$$;

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
  p_force_rest boolean default true
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

grant execute on function last_day_defaults(uuid) to authenticated;
grant execute on function create_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text, boolean) to authenticated;
grant execute on function update_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, jsonb, text, boolean) to authenticated;
