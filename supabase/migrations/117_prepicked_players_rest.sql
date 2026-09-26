-- ============================================================
-- 117 — ผู้เล่นที่เลือกไว้ตอนสร้างวันเล่น เริ่มที่ "พัก" ไม่ใช่ "รอคิว"
-- ------------------------------------------------------------
-- ตอนสร้างวันเล่นคือการจองรายชื่อไว้ล่วงหน้า คนยังไม่มาถึงสนาม แต่เดิม
-- ใส่เป็น waiting ทำให้ระบบจับคนที่ยังไม่มาลงคอร์ตได้ คนจัดก๊วนต้องคอยกด
-- "พัก" ให้คนที่ยังไม่มาทีละคนก่อนเริ่มจับคู่ ซึ่งกลับหัวกลับหางกับความจริง
--
-- สลับเป็น resting แล้วขั้นตอนตรงกับหน้างาน: เปิดวันมาทุกคนพักอยู่
-- ใครมาถึงก็กดชื่อคนนั้นเข้าคิว (แถบ "พักอยู่" บนแท็บคอร์ต)
--
-- add_player ไม่เปลี่ยน — คนที่พิมพ์ชื่อเพิ่มหน้างานคือคนที่มาแล้ว
-- ไม่กระทบวันเล่นที่สร้างไว้ก่อนหน้านี้ (แก้แค่ฟังก์ชัน ไม่แตะข้อมูลเดิม)
-- ============================================================

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

grant execute on function create_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text, boolean) to authenticated;
