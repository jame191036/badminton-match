-- ============================================================
-- 101 — แยก "รุ่น" ออกจากยี่ห้อลูกแบด
-- ------------------------------------------------------------
-- เดิม shuttle_brands มีแค่ name ทำให้ต้องพิมพ์รวมกันเป็น "RSL Classic"
-- แยก model ออกมาเพื่อให้ยี่ห้อเดียวกันมีหลายรุ่นได้
--
-- รันไฟล์นี้ใน SQL editor (schema.sql ถูกแก้ให้ตรงกันแล้วสำหรับฐานใหม่)
-- ============================================================

alter table shuttle_brands add column if not exists model text;

-- ยี่ห้อเดียวกันคนละรุ่นต้องอยู่ด้วยกันได้ จึงต้องรวม model เข้าไปใน unique index
drop index if exists uq_shuttle_brands_owner_name;

create unique index uq_shuttle_brands_owner_name
  on shuttle_brands(owner_id, lower(trim(name)), lower(trim(coalesce(model, ''))));


-- ------------------------------------------------------------
-- create_play_day: snapshot ชื่อยี่ห้อให้รวมรุ่นไปด้วย
-- sessions.shuttle_brand_name เป็น snapshot ไว้ "แสดงผล" เผื่อ master ถูกลบ
-- จึงเก็บเป็นข้อความเดียว "RSL Classic" ไม่ต้องแตกเป็นสองคอลัมน์
-- ------------------------------------------------------------
create or replace function create_play_day(
  p_club_id uuid,
  p_play_date date,
  p_start_time time default null,
  p_end_time time default null,
  p_venue_id uuid default null,
  p_shuttle_brand_id uuid default null,
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
    select trim(name || ' ' || coalesce(model, '')) into v_brand_name
    from shuttle_brands where id = p_shuttle_brand_id and owner_id = v_owner_id;
    if v_brand_name is null then
      raise exception 'ไม่พบยี่ห้อลูกแบดที่เลือก';
    end if;
  end if;

  insert into sessions (
    club_id, venue_id, venue_name, shuttle_brand_id, shuttle_brand_name,
    play_date, start_time, end_time, status,
    hourly_rate, shuttle_price, shuttle_count, queue_mode, note
  )
  values (
    p_club_id, p_venue_id, v_venue_name, p_shuttle_brand_id, v_brand_name,
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

grant execute on function create_play_day(uuid, date, time, time, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text) to authenticated;
