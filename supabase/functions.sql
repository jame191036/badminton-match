-- ============================================================
-- RPC Functions — เรียกจาก client ผ่าน supabase.rpc('...')
-- รวม logic ที่แตะหลายตารางไว้เป็น transaction เดียวต่อครั้ง
--
-- *** ทุกฟังก์ชันเป็น SECURITY DEFINER ซึ่งข้าม RLS ไปเอง ***
-- จึงต้องเช็คสิทธิ์ด้วยมือทุกตัว ผ่าน can_edit_club / can_edit_session
-- และต้อง grant execute ให้ authenticated ท้ายไฟล์
-- ============================================================


-- ============================================================
-- ก๊วน (master)
-- ============================================================

-- ------------------------------------------------------------
-- สร้างก๊วน + ใส่สิทธิ์ owner ให้ตัวเอง (2 ตาราง จึงต้องเป็น RPC)
-- ------------------------------------------------------------
create or replace function create_club(p_name text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;

  if char_length(v_name) = 0 then
    raise exception 'ต้องใส่ชื่อก๊วน';
  end if;

  insert into clubs (owner_id, name, note)
  values (auth.uid(), v_name, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_club_id;

  insert into club_access (club_id, user_id, role)
  values (v_club_id, auth.uid(), 'owner');

  return v_club_id;
end;
$$;

-- ------------------------------------------------------------
-- แชร์ก๊วนให้คนอื่นด้วยอีเมล — คนนั้นต้องมีบัญชีในระบบแล้ว
-- (ระบบเชิญคนที่ยังไม่เคยสมัครยังไม่ทำในรอบนี้)
-- ------------------------------------------------------------
create or replace function grant_club_access(
  p_club_id uuid,
  p_email text,
  p_role text default 'viewer'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not is_club_owner(p_club_id) then
    raise exception 'เฉพาะเจ้าของก๊วนเท่านั้นที่แชร์ก๊วนได้';
  end if;

  if p_role not in ('editor', 'viewer') then
    raise exception 'บทบาทต้องเป็น editor หรือ viewer เท่านั้น';
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email;

  if v_user_id is null then
    raise exception 'ยังไม่มีบัญชีของอีเมลนี้ ให้เขาสมัครเข้าใช้งานก่อน';
  end if;

  if v_user_id = auth.uid() then
    raise exception 'คุณเป็นเจ้าของก๊วนนี้อยู่แล้ว';
  end if;

  insert into club_access (club_id, user_id, role)
  values (p_club_id, v_user_id, p_role)
  on conflict (club_id, user_id) do update set role = excluded.role;

  return v_user_id;
end;
$$;

create or replace function revoke_club_access(p_club_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_club_owner(p_club_id) then
    raise exception 'เฉพาะเจ้าของก๊วนเท่านั้นที่จัดการสิทธิ์ได้';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'เอาตัวเองออกจากก๊วนที่เป็นเจ้าของไม่ได้';
  end if;

  delete from club_access where club_id = p_club_id and user_id = p_user_id;
end;
$$;

-- ------------------------------------------------------------
-- รายชื่อคนที่เข้าถึงก๊วนนี้ได้ พร้อมอีเมล
-- ต้องเป็น RPC ไม่ใช่ view เพราะ role authenticated อ่าน auth.users ไม่ได้
-- ------------------------------------------------------------
create or replace function list_club_members(p_club_id uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_view_club(p_club_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงก๊วนนี้';
  end if;

  return query
  select a.user_id, u.email::text, a.role, a.created_at
  from club_access a
  join auth.users u on u.id = a.user_id
  where a.club_id = p_club_id
  order by a.created_at;
end;
$$;


-- ============================================================
-- วันเล่น
-- ============================================================

-- ------------------------------------------------------------
-- ค่าตั้งต้นสำหรับฟอร์มสร้างวันเล่น เอามาจากวันล่าสุดของก๊วนนี้
-- (สนามเดิม ราคาเดิม ยี่ห้อลูกเดิม คอร์ตเดิม รายชื่อคนเดิม)
-- ฝั่งแอปเอาไป prefill เพื่อให้เหลือแค่กดยืนยัน
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

-- ------------------------------------------------------------
-- สร้างวันเล่น พร้อมคอร์ตและรายชื่อผู้เล่น ในทรานแซกชันเดียว
--
-- ราคาปล่อยเป็น null ได้ = ยังไม่รู้ตอนสร้าง ค่อยมากรอกตอนจบวัน
-- (ราคาจริงมักรู้ตอนจบ ถ้าบังคับกรอกตอนสร้างจะได้ตัวเลขมั่ว)
--
-- p_courts รูปแบบ: [{"name": "คอร์ต 1", "hours": 2}, ...]
-- master ที่เลือกได้ต้องเป็นของ "เจ้าของก๊วน" เสมอ แม้คนสร้างจะเป็น editor
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- แก้ไขวันเล่นที่จองไว้ — ทำได้เฉพาะตอนยัง planned
--   playing   ราคาแก้ได้ในแท็บหารเงินอยู่แล้ว วันที่/สนามไม่ควรขยับกลางคัน
--   done      ยอดถูก freeze แล้ว แก้ย้อนหลัง = ประวัติเพี้ยน
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- เริ่มวันเล่น: planned -> playing
-- หนึ่งก๊วนมีวันที่กำลังเล่นได้ทีละวัน (มี partial unique index กันอีกชั้น
-- แต่เช็คเองก่อนเพื่อให้ได้ข้อความไทยแทน error ของ index)
-- ------------------------------------------------------------
create or replace function start_play_day(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_status text;
begin
  select club_id, status into v_club_id, v_status
  from sessions where id = p_session_id;

  if v_club_id is null or not can_edit_session(p_session_id) then
    raise exception 'ไม่พบวันเล่นนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  if v_status = 'playing' then
    return; -- กดซ้ำ ไม่ต้องทำอะไร
  end if;

  if v_status <> 'planned' then
    raise exception 'วันเล่นนี้จบหรือถูกยกเลิกไปแล้ว';
  end if;

  if exists (select 1 from sessions where club_id = v_club_id and status = 'playing') then
    raise exception 'ก๊วนนี้มีวันที่กำลังเล่นอยู่แล้ว ต้องกดจบวันนั้นก่อน';
  end if;

  update sessions set status = 'playing' where id = p_session_id;
end;
$$;

-- ------------------------------------------------------------
-- ยกเลิกวันที่จองไว้แต่ไม่ได้ไป (ทำได้เฉพาะตอนยัง planned)
-- ------------------------------------------------------------
create or replace function cancel_play_day(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_edit_session(p_session_id) then
    raise exception 'ไม่พบวันเล่นนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  update sessions set status = 'cancelled'
  where id = p_session_id and status = 'planned';

  if not found then
    raise exception 'ยกเลิกได้เฉพาะวันที่ยังไม่เริ่มเล่นเท่านั้น';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- จบการเล่นประจำวัน: freeze ยอดเงินและสถิติไว้ถาวร
-- ถ้าปล่อยให้คำนวณสดต่อไป พอสนามขึ้นราคาแล้วแก้เรท
-- ยอดของวันเก่าจะเปลี่ยนตาม ทั้งที่จ่ายกันไปแล้วจริง
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
  if not can_edit_session(p_session_id) then
    raise exception 'ไม่พบวันเล่นนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  if not exists (
    select 1 from sessions where id = p_session_id and status = 'playing'
  ) then
    raise exception 'จบได้เฉพาะวันที่กำลังเล่นอยู่เท่านั้น';
  end if;

  if exists (
    select 1 from matches
    where session_id = p_session_id and status in ('pending', 'playing')
  ) then
    raise exception 'ยังมีเกมค้างอยู่ในคอร์ต ต้องจบเกมหรือยกเลิกให้หมดก่อนจบวัน';
  end if;

  select * into v_bill from v_billing_summary where session_id = p_session_id;
  select * into v_sum  from v_session_summary where session_id = p_session_id;

  update sessions
  set status              = 'done',
      closed_at           = now(),
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


-- ============================================================
-- ผู้เล่นในวันเล่น
-- ============================================================

-- ------------------------------------------------------------
-- เพิ่มผู้เล่นเข้าวันเล่น — upsert เข้ารายชื่อ master ให้อัตโนมัติ
-- ใช้ทั้งตอนเลือกล่วงหน้าและตอนมีแขกโผล่มาหน้างาน
-- ------------------------------------------------------------
create or replace function add_player(
  p_session_id uuid,
  p_name text,
  p_skill smallint,
  p_save_to_master boolean default true
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
  v_name text := trim(coalesce(p_name, ''));
  v_skill smallint := p_skill;
begin
  if not can_edit_session(p_session_id) then
    raise exception 'ไม่พบวันเล่นนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  if not exists (
    select 1 from sessions where id = p_session_id and status in ('planned', 'playing')
  ) then
    raise exception 'วันเล่นนี้จบหรือถูกยกเลิกไปแล้ว';
  end if;

  if char_length(v_name) = 0 then
    raise exception 'ต้องใส่ชื่อผู้เล่น';
  end if;

  select c.owner_id into v_owner_id
  from sessions s join clubs c on c.id = s.club_id
  where s.id = p_session_id;

  -- แขกขาจร (p_save_to_master = false) ไม่ถูกบันทึกเข้ารายชื่อ master
  --
  -- ชื่อที่มีอยู่แล้ว: ใช้ชื่อและระดับมือของสมาชิกคนนั้น ไม่เขียนทับ master
  -- (ช่องระดับมือหน้างานตั้งค่าเริ่มไว้ที่ "มือกลาง" ถ้าเขียนทับ พิมพ์ชื่อคน
  --  มือเก่งเข้าวันเล่นทีเดียว ข้อมูลหลักของเขาก็กลายเป็นมือกลางเงียบ ๆ)
  if p_save_to_master then
    insert into members (owner_id, name, default_skill)
    values (v_owner_id, v_name, p_skill)
    on conflict (owner_id, lower(trim(name))) do nothing;

    select id, name, default_skill into v_member_id, v_name, v_skill
    from members
    where owner_id = v_owner_id and lower(trim(name)) = lower(v_name);
  end if;

  -- ชื่อซ้ำในวันเดียวกันแยกคนไม่ออกบนกระดาน — กันทั้งสมาชิกและแขก
  if exists (
    select 1 from players
    where session_id = p_session_id
      and (member_id = v_member_id or lower(trim(name)) = lower(v_name))
  ) then
    raise exception '% อยู่ในวันเล่นนี้แล้ว', v_name;
  end if;

  insert into players (session_id, member_id, name, skill)
  values (p_session_id, v_member_id, v_name, v_skill)
  returning id into v_player_id;

  return v_player_id;
end;
$$;

-- ------------------------------------------------------------
-- เช็คชื่อ: คนที่ลงชื่อไว้แต่ไม่มา -> absent (ไม่เข้าคิว ไม่ถูกนับหารเงิน)
-- กลับมา -> waiting และไปต่อท้ายคิว
-- คนที่อยู่ในคอร์ตแล้วเปลี่ยนไม่ได้ ต้องเอาออกจากคอร์ตก่อน
-- ------------------------------------------------------------
create or replace function set_player_attendance(p_player_id uuid, p_present boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_status text;
begin
  select session_id, status into v_session_id, v_status
  from players where id = p_player_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบผู้เล่นคนนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  if v_status = 'playing' then
    raise exception 'ผู้เล่นอยู่ในคอร์ต ต้องจบเกมหรือยกเลิกคอร์ตก่อน';
  end if;

  if p_present then
    update players
    set status = 'waiting',
        queue_seq = nextval(pg_get_serial_sequence('players', 'queue_seq'))
    where id = p_player_id and status = 'absent';
  else
    update players set status = 'absent' where id = p_player_id;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- เอาผู้เล่นที่พักอยู่กลับเข้าคิว (ไปต่อท้ายคิว)
-- ------------------------------------------------------------
create or replace function resume_player_queue(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  select session_id into v_session_id from players where id = p_player_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบผู้เล่นคนนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  update players
  set status = 'waiting',
      queue_seq = nextval(pg_get_serial_sequence('players', 'queue_seq'))
  where id = p_player_id and status = 'resting';
end;
$$;


-- ============================================================
-- คอร์ตและเกม
-- ============================================================

-- ------------------------------------------------------------
-- จับคู่ผู้เล่น 4 คนลงคอร์ต: สร้าง match แบบ 'pending' + match_players
-- ยังไม่จับเวลา (started_at = null) รอกด start_match ก่อน
-- ระหว่าง pending สลับตัวได้ด้วย substitute_player
-- ------------------------------------------------------------
create or replace function assign_court(
  p_court_id uuid,
  p_team_a uuid[],
  p_team_b uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_court_name text;
  v_match_id uuid;
begin
  select c.session_id, c.name into v_session_id, v_court_name
  from courts c where c.id = p_court_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบคอร์ตนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  if not exists (select 1 from sessions where id = v_session_id and status = 'playing') then
    raise exception 'ต้องกดเริ่มวันเล่นก่อนถึงจะจัดคนลงคอร์ตได้';
  end if;

  if coalesce(array_length(p_team_a, 1), 0) <> 2
     or coalesce(array_length(p_team_b, 1), 0) <> 2
     or (select count(distinct x) from unnest(p_team_a || p_team_b) x) <> 4 then
    raise exception 'ต้องจับคู่ 2 ต่อ 2 และเป็นคนละคนกันทั้ง 4 คน';
  end if;

  -- ล็อกแถวก่อนเช็ค: สองเครื่อง (หรือกดสองคอร์ตติดกัน) จับคนชุดเดียวกัน
  -- คำสั่งหลังจะรอจนคำสั่งแรกจบ แล้วเห็นว่าคนเหล่านี้ไม่ได้ 'waiting' แล้ว
  perform 1 from players where id = any(p_team_a || p_team_b) for update;

  if (
    select count(*) from players
    where id = any(p_team_a || p_team_b)
      and session_id = v_session_id
      and status = 'waiting'
  ) <> 4 then
    raise exception 'มีผู้เล่นที่ไม่ได้รอคิวอยู่แล้ว (อาจถูกจัดลงคอร์ตอื่นไปก่อน) — ลองจับคู่ใหม่อีกครั้ง';
  end if;

  insert into matches (session_id, court_id, court_name, status, started_at)
  values (v_session_id, p_court_id, v_court_name, 'pending', null)
  returning id into v_match_id;

  insert into match_players (match_id, player_id, player_name, skill, team)
  select v_match_id, id, name, skill, 'A' from players where id = any(p_team_a);

  insert into match_players (match_id, player_id, player_name, skill, team)
  select v_match_id, id, name, skill, 'B' from players where id = any(p_team_b);

  -- status 'playing' ที่นี่แปลว่า "อยู่ในคอร์ตแล้ว" (รวมรอเริ่ม)
  -- เพื่อกันไม่ให้ถูกดึงไปลงคอร์ตอื่นหรือถูกเลือกมาเป็นตัวสำรองซ้ำ
  update players set status = 'playing'
  where id = any(p_team_a || p_team_b);

  return v_match_id;
end;
$$;

-- ------------------------------------------------------------
-- เริ่มเกมจริง: pending -> playing และเริ่มจับเวลาตรงนี้
-- ------------------------------------------------------------
create or replace function start_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_player_count int;
begin
  select session_id into v_session_id from matches where id = p_match_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบเกมนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  -- player_id เป็น null ได้ถ้าผู้เล่นถูกลบทิ้ง แถวนั้นไม่ใช่คนจริงในคอร์ต
  select count(player_id) into v_player_count from match_players where match_id = p_match_id;
  if v_player_count <> 4 then
    raise exception 'ต้องมีผู้เล่นครบ 4 คนถึงจะเริ่มเกมได้ (ตอนนี้ % คน)', v_player_count;
  end if;

  update matches
  set status = 'playing', started_at = now()
  where id = p_match_id and status = 'pending';

  if not found then
    raise exception 'เกมนี้เริ่มไปแล้ว';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- สลับตัว (ทำได้เฉพาะตอน pending):
-- เอาคนที่ยังไม่พร้อมออกไปพัก แล้วดึงคนแรกในคิวมาแทนในทีมเดิม
-- คืนค่า id ของคนที่มาแทน (null = ไม่มีใครรอคิวอยู่ ปล่อยช่องว่างไว้)
-- ------------------------------------------------------------
create or replace function substitute_player(p_match_id uuid, p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_team text;
  v_replacement uuid;
begin
  select session_id into v_session_id
  from matches where id = p_match_id and status = 'pending';

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบเกมนี้ ไม่มีสิทธิ์แก้ไข หรือเกมเริ่มไปแล้ว';
  end if;

  select team into v_team
  from match_players
  where match_id = p_match_id and player_id = p_player_id;

  if v_team is null then
    raise exception 'ผู้เล่นคนนี้ไม่ได้อยู่ในเกมนี้';
  end if;

  -- ลบแถวทิ้ง = ไม่ถูกนับเป็นเกมของคนนี้ตอน finish_match
  -- (finish_match แตะเฉพาะแถวที่ยังอยู่ จึงไม่ต้องมี flag "เล่นจริงไหม" ที่ไหนเลย)
  delete from match_players where match_id = p_match_id and player_id = p_player_id;
  update players set status = 'resting' where id = p_player_id;

  -- ตัวสำรอง: คนแรกในคิวตามเกณฑ์เดิม (เล่นน้อยสุด แล้วรอนานสุด)
  select p.id into v_replacement
  from players p
  where p.session_id = v_session_id and p.status = 'waiting'
  order by p.games_played, p.queue_seq
  limit 1;

  if v_replacement is not null then
    insert into match_players (match_id, player_id, player_name, skill, team)
    select p_match_id, id, name, skill, v_team from players where id = v_replacement;

    update players set status = 'playing' where id = v_replacement;
  end if;

  return v_replacement;
end;
$$;

-- ------------------------------------------------------------
-- ยกเลิกเกมที่ยังไม่เริ่ม: คืนทุกคนเข้าคิวที่เดิม
-- (ไม่นับเกม ไม่ขยับ queue_seq เพราะยังไม่ได้เล่น)
-- จำเป็นเพื่อไม่ให้คอร์ตค้าง เวลาสลับตัวแล้วหาคนแทนไม่ได้จนไม่ครบ 4
-- ------------------------------------------------------------
create or replace function cancel_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  select session_id into v_session_id
  from matches where id = p_match_id and status = 'pending';

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบเกมนี้ ไม่มีสิทธิ์แก้ไข หรือเกมเริ่มไปแล้ว';
  end if;

  update players
  set status = 'waiting'
  where id in (
    select player_id from match_players
    where match_id = p_match_id and player_id is not null
  );

  delete from matches where id = p_match_id; -- cascade ลบ match_players ด้วย
end;
$$;

-- ------------------------------------------------------------
-- เติมที่ว่างในเกมที่ยังไม่เริ่ม ด้วยคนแรกในคิว (เกณฑ์เดียวกับ substitute_player)
-- ที่ว่างเกิดจากสลับตัวตอนไม่มีใครรอคิว — พอมีคนกลับเข้าคิวแล้ว
-- ต้องมีทางเติมให้ครบ ไม่งั้นทางเดียวคือยกเลิกทั้งเกม
-- คืนจำนวนคนที่เติมเข้าไป (0 = คิวว่าง)
-- ------------------------------------------------------------
create or replace function fill_match(p_match_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_team text;
  v_next uuid;
  v_added int := 0;
begin
  select session_id into v_session_id
  from matches where id = p_match_id and status = 'pending'
  for update;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบเกมนี้ ไม่มีสิทธิ์แก้ไข หรือเกมเริ่มไปแล้ว';
  end if;

  foreach v_team in array array['A', 'B'] loop
    while (
      select count(player_id) from match_players
      where match_id = p_match_id and team = v_team
    ) < 2 loop
      select p.id into v_next
      from players p
      where p.session_id = v_session_id and p.status = 'waiting'
      order by p.games_played, p.queue_seq
      limit 1
      for update skip locked;

      exit when v_next is null;

      insert into match_players (match_id, player_id, player_name, skill, team)
      select p_match_id, id, name, skill, v_team from players where id = v_next;

      update players set status = 'playing' where id = v_next;
      v_added := v_added + 1;
    end loop;
  end loop;

  return v_added;
end;
$$;

-- ------------------------------------------------------------
-- จบเกม: ปิด match, คืนผู้เล่นเข้าคิว, +1 เกมที่เล่น, ไปต่อท้ายคิว
-- นับเกมให้เฉพาะคนที่ยังอยู่ใน match_players ตอนจบ
-- (คนที่ถูกสลับออกไปก่อนเริ่มจึงไม่ถูกนับ — ดู substitute_player)
-- ------------------------------------------------------------
create or replace function finish_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  select session_id into v_session_id from matches where id = p_match_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบเกมนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  update matches
  set ended_at = now(), status = 'done'
  where id = p_match_id and status = 'playing';

  if not found then
    raise exception 'เกมนี้ยังไม่ได้เริ่ม หรือจบไปแล้ว';
  end if;

  update players
  set status = 'waiting',
      games_played = games_played + 1,
      queue_seq = nextval(pg_get_serial_sequence('players', 'queue_seq'))
  where id in (
    select player_id from match_players
    where match_id = p_match_id and player_id is not null
  );
end;
$$;

-- ------------------------------------------------------------
-- ลบคอร์ต: ถ้ามีเกมค้างอยู่ คืนผู้เล่นเข้าคิว
-- (ไม่นับเป็นเกมที่เล่นจบ ไม่เปลี่ยนลำดับคิว) แล้วลบคอร์ตทิ้ง
-- ------------------------------------------------------------
create or replace function remove_court(p_court_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_match_id uuid;
begin
  select session_id into v_session_id from courts where id = p_court_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบคอร์ตนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  select id into v_match_id
  from matches
  where court_id = p_court_id and ended_at is null;

  if v_match_id is not null then
    update players
    set status = 'waiting'
    where id in (
      select player_id from match_players
      where match_id = v_match_id and player_id is not null
    );
    delete from matches where id = v_match_id; -- cascade ลบ match_players ด้วย
  end if;

  delete from courts where id = p_court_id;
end;
$$;

-- ------------------------------------------------------------
-- เปลี่ยนชื่อคอร์ต — ไปถึงสนามจริงแล้วได้คอร์ตคนละเบอร์กับที่จองไว้
--
-- matches.court_name เป็น snapshot ที่ถ่ายไว้ตอน assign_court เกมที่ยัง
-- เล่นไม่จบต้องเปลี่ยนตามด้วย ส่วนเกมที่จบแล้วคงชื่อเดิม (ตอนนั้นคอร์ต
-- ชื่อนั้นจริง ๆ) — เพราะแตะสองตารางจึงต้องเป็น RPC ไม่ใช่ update ตรง ๆ
-- ------------------------------------------------------------
create or replace function rename_court(p_court_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_status text;
  v_name text := trim(coalesce(p_name, ''));
begin
  select c.session_id, s.status into v_session_id, v_status
  from courts c join sessions s on s.id = c.session_id
  where c.id = p_court_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบคอร์ตนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  -- วันที่จบหรือยกเลิกไปแล้วห้ามแตะ ประวัติต้องนิ่ง
  if v_status not in ('planned', 'playing') then
    raise exception 'วันเล่นนี้จบหรือถูกยกเลิกไปแล้ว';
  end if;

  if char_length(v_name) = 0 then
    raise exception 'ต้องใส่ชื่อคอร์ต';
  end if;

  update courts set name = v_name where id = p_court_id;

  update matches
  set court_name = v_name
  where court_id = p_court_id and ended_at is null;
end;
$$;


-- ============================================================
-- Grants — RPC ทุกตัวต้องอยู่ในรายการนี้ ไม่งั้น client เรียกไม่ได้
-- ============================================================
grant execute on function create_club(text, text) to authenticated;
grant execute on function grant_club_access(uuid, text, text) to authenticated;
grant execute on function revoke_club_access(uuid, uuid) to authenticated;
grant execute on function list_club_members(uuid) to authenticated;

grant execute on function last_day_defaults(uuid) to authenticated;
grant execute on function create_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, uuid[], jsonb, text) to authenticated;
grant execute on function update_play_day(uuid, date, time, time, uuid, uuid, uuid, numeric, numeric, int, text, jsonb, text) to authenticated;
grant execute on function start_play_day(uuid) to authenticated;
grant execute on function cancel_play_day(uuid) to authenticated;
grant execute on function close_session(uuid) to authenticated;

grant execute on function add_player(uuid, text, smallint, boolean) to authenticated;
grant execute on function set_player_attendance(uuid, boolean) to authenticated;
grant execute on function resume_player_queue(uuid) to authenticated;

grant execute on function assign_court(uuid, uuid[], uuid[]) to authenticated;
grant execute on function start_match(uuid) to authenticated;
grant execute on function substitute_player(uuid, uuid) to authenticated;
grant execute on function cancel_match(uuid) to authenticated;
grant execute on function fill_match(uuid) to authenticated;
grant execute on function finish_match(uuid) to authenticated;
grant execute on function remove_court(uuid) to authenticated;
grant execute on function rename_court(uuid, text) to authenticated;
