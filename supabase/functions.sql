-- ============================================================
-- RPC Functions — เรียกจาก client ผ่าน supabase.rpc('...')
-- รวม logic ที่แตะหลายตารางไว้เป็น transaction เดียวต่อครั้ง
-- (ทุกฟังก์ชันเป็น SECURITY DEFINER ซึ่งข้าม RLS ไปเอง
--  จึงต้องเช็ค ownership ด้วยมือในทุกฟังก์ชัน)
-- ============================================================

-- ------------------------------------------------------------
-- จับคู่ผู้เล่น 4 คนลงคอร์ต: สร้าง match + match_players
-- แล้วเปลี่ยนสถานะผู้เล่นเป็น 'playing'
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

  insert into matches (session_id, court_id, court_name)
  values (v_session_id, p_court_id, v_court_name)
  returning id into v_match_id;

  insert into match_players (match_id, player_id, player_name, skill, team)
  select v_match_id, id, name, skill, 'A' from players where id = any(p_team_a);

  insert into match_players (match_id, player_id, player_name, skill, team)
  select v_match_id, id, name, skill, 'B' from players where id = any(p_team_b);

  update players set status = 'playing'
  where id = any(p_team_a || p_team_b);

  return v_match_id;
end;
$$;

-- ------------------------------------------------------------
-- จบเกม: ปิด match, คืนผู้เล่นเข้าคิว, +1 เกมที่เล่น, ไปต่อท้ายคิว
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

  update matches set ended_at = now()
  where id = p_match_id and ended_at is null;

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

grant execute on function assign_court(uuid, uuid[], uuid[]) to authenticated;
grant execute on function finish_match(uuid) to authenticated;
grant execute on function remove_court(uuid) to authenticated;
grant execute on function resume_player_queue(uuid) to authenticated;
grant execute on function get_or_create_my_session() to authenticated;
