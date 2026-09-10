-- ============================================================
-- RPC Functions — เรียกจาก client ผ่าน supabase.rpc('...')
-- รวม logic ที่แตะหลายตารางไว้เป็น transaction เดียวต่อครั้ง
-- (ทุกฟังก์ชันเป็น SECURITY DEFINER ซึ่งข้าม RLS ไปเอง
--  จึงต้องเช็ค ownership ด้วยมือในทุกฟังก์ชัน)
-- ============================================================

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
-- ถ้าปล่อยให้คำนวณสดต่อไป พอสนามขึ้นราคาแล้วแก้เรท
-- ประวัติเก่าจะเปลี่ยนยอดตามไปด้วย ทั้งที่จ่ายกันไปแล้วจริง
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

  insert into players (session_id, member_id, name, skill)
  select v_session_id, m.id, m.name, m.default_skill
  from members m
  where m.owner_id = auth.uid() and m.id = any(p_member_ids);

  return v_session_id;
end;
$$;

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
  from courts c
  join sessions s on s.id = c.session_id
  where c.id = p_court_id and s.owner_id = auth.uid();

  if v_session_id is null then
    raise exception 'court not found or access denied';
  end if;

  if exists (
    select 1 from players
    where id = any(p_team_a || p_team_b) and session_id <> v_session_id
  ) then
    raise exception 'players do not belong to this session';
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
  v_player_count int;
begin
  if not exists (
    select 1 from matches m
    join sessions s on s.id = m.session_id
    where m.id = p_match_id and s.owner_id = auth.uid()
  ) then
    raise exception 'match not found or access denied';
  end if;

  select count(*) into v_player_count from match_players where match_id = p_match_id;
  if v_player_count <> 4 then
    raise exception 'ต้องมีผู้เล่นครบ 4 คนถึงจะเริ่มเกมได้ (ตอนนี้ % คน)', v_player_count;
  end if;

  update matches
  set status = 'playing', started_at = now()
  where id = p_match_id and status = 'pending';

  if not found then
    raise exception 'match is not pending';
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
  select m.session_id into v_session_id
  from matches m
  join sessions s on s.id = m.session_id
  where m.id = p_match_id and s.owner_id = auth.uid() and m.status = 'pending';

  if v_session_id is null then
    raise exception 'match not found, access denied, or already started';
  end if;

  select team into v_team
  from match_players
  where match_id = p_match_id and player_id = p_player_id;

  if v_team is null then
    raise exception 'player is not in this match';
  end if;

  -- ลบแถวทิ้ง = ไม่ถูกนับเป็นเกมของคนนี้ตอน finish_match
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
-- ยกเลิกแมตช์ที่ยังไม่เริ่ม: คืนทุกคนเข้าคิวที่เดิม
-- (ไม่นับเกม ไม่ขยับ queue_seq เพราะยังไม่ได้เล่น)
-- จำเป็นเพื่อไม่ให้คอร์ตค้าง เวลาสลับตัวแล้วหาคนแทนไม่ได้จนไม่ครบ 4
-- ------------------------------------------------------------
create or replace function cancel_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from matches m
    join sessions s on s.id = m.session_id
    where m.id = p_match_id and s.owner_id = auth.uid() and m.status = 'pending'
  ) then
    raise exception 'match not found, access denied, or already started';
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
-- จบเกม: ปิด match, คืนผู้เล่นเข้าคิว, +1 เกมที่เล่น, ไปต่อท้ายคิว
-- นับเกมให้เฉพาะคนที่ยังอยู่ใน match_players ตอนจบ
-- (คนที่ถูกสลับออกไปก่อนเริ่มจึงไม่ถูกนับ)
-- ------------------------------------------------------------
create or replace function finish_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from matches m
    join sessions s on s.id = m.session_id
    where m.id = p_match_id and s.owner_id = auth.uid()
  ) then
    raise exception 'match not found or access denied';
  end if;

  update matches
  set ended_at = now(), status = 'done'
  where id = p_match_id and status = 'playing';

  if not found then
    raise exception 'match is not in progress';
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
-- ยกเลิกคอร์ต: ถ้ามีเกมกำลังเล่นอยู่ คืนผู้เล่นเข้าคิว
-- (ไม่นับเป็นเกมที่เล่นจบ ไม่เปลี่ยนลำดับคิว) แล้วลบคอร์ตทิ้ง
-- ------------------------------------------------------------
create or replace function remove_court(p_court_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if not exists (
    select 1 from courts c
    join sessions s on s.id = c.session_id
    where c.id = p_court_id and s.owner_id = auth.uid()
  ) then
    raise exception 'court not found or access denied';
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
-- เอาผู้เล่นที่พักอยู่กลับเข้าคิว (ไปต่อท้ายคิว)
-- ------------------------------------------------------------
create or replace function resume_player_queue(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from players p
    join sessions s on s.id = p.session_id
    where p.id = p_player_id and s.owner_id = auth.uid()
  ) then
    raise exception 'player not found or access denied';
  end if;

  update players
  set status = 'waiting',
      queue_seq = nextval(pg_get_serial_sequence('players', 'queue_seq'))
  where id = p_player_id and status = 'resting';
end;
$$;

grant execute on function add_player(uuid, text, smallint) to authenticated;
grant execute on function close_session(uuid) to authenticated;
grant execute on function open_session(text, uuid[]) to authenticated;
grant execute on function assign_court(uuid, uuid[], uuid[]) to authenticated;
grant execute on function start_match(uuid) to authenticated;
grant execute on function substitute_player(uuid, uuid) to authenticated;
grant execute on function cancel_match(uuid) to authenticated;
grant execute on function finish_match(uuid) to authenticated;
grant execute on function remove_court(uuid) to authenticated;
grant execute on function resume_player_queue(uuid) to authenticated;
grant execute on function get_or_create_my_session() to authenticated;
