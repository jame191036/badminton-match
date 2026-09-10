-- ============================================================
-- 002 — สถานะ pending ก่อนเริ่มเกม + สลับตัวผู้เล่น
-- ------------------------------------------------------------
-- เดิม: จับคู่ปุ๊บ = เริ่มเล่นทันที (started_at = now() ตอน insert)
-- ใหม่: จับคู่ -> pending (รอยืนยัน) -> playing (กดเริ่มเกม) -> จบ
--
-- ระหว่าง pending สลับตัวได้ผ่าน substitute_player() ซึ่งลบแถวใน
-- match_players ทิ้ง ทำให้ "คนที่พักไม่ถูกนับเกมนั้น" เกิดขึ้นเอง
-- เพราะ finish_match() +1 games_played ให้เฉพาะแถวที่ยังอยู่ตอนจบ
--
-- รันไฟล์นี้ใน Supabase SQL editor ต่อจาก 001
-- ============================================================

alter table matches
  add column if not exists status text not null default 'playing'
    check (status in ('pending', 'playing', 'done'));

-- แมตช์ที่ยังไม่กดเริ่ม จะยังไม่มีเวลาเริ่ม
alter table matches alter column started_at drop not null;
alter table matches alter column started_at drop default;

-- ข้อมูลเดิม: ที่จบไปแล้วคือ done ที่ค้างอยู่ถือว่ากำลังเล่น (playing)
update matches set status = 'done' where ended_at is not null and status <> 'done';

create index if not exists idx_matches_status on matches(session_id, status);


-- ============================================================
-- assign_court — เปลี่ยนเป็นสร้างแมตช์แบบ pending (ยังไม่เริ่มจับเวลา)
-- ============================================================
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
-- finish_match — เพิ่มการเช็ค/อัปเดต status
-- นับเกมให้เฉพาะคนที่ยังอยู่ใน match_players ตอนจบ
-- (คนที่ถูกสลับออกไปแล้วจึงไม่ถูกนับ)
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


grant execute on function start_match(uuid) to authenticated;
grant execute on function substitute_player(uuid, uuid) to authenticated;
grant execute on function cancel_match(uuid) to authenticated;
