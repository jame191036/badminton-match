-- ============================================================
-- 108 — แก้ไขวันเล่นที่จองไว้
-- ------------------------------------------------------------
-- เดิมสร้างวันเล่นแล้วแก้อะไรไม่ได้เลย จองผิดวันหรือย้ายสนามต้องยกเลิก
-- แล้วสร้างใหม่พร้อมเลือกผู้เล่นใหม่ทั้งหมด ซึ่งขัดกับจุดประสงค์ของ
-- ฟีเจอร์จองล่วงหน้า
--
-- จำกัดไว้เฉพาะวันที่ยัง 'planned':
--   playing   — ราคาแก้ได้อยู่แล้วในแท็บหารเงิน ส่วนวันที่/สนามไม่ควรขยับ
--               กลางคัน เพราะมีเกมที่จับเวลาอยู่แล้ว
--   done      — ยอดถูก freeze ไปแล้ว แก้ย้อนหลัง = ประวัติเพี้ยน
--   cancelled — ยกเลิกแล้วก็จบ
-- ============================================================

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
  p_note text default null
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

grant execute on function update_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, jsonb, text) to authenticated;
