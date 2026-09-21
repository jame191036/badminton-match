-- 111: แก้บั๊กจากการทดสอบทุกฟีเจอร์
--
-- assign_court  ล็อกแถวแล้วบังคับว่าทั้ง 4 คนยัง 'waiting' และเป็น 2 ต่อ 2 คนละคน
--               (เดิมกดจับคู่สองคอร์ตติดกัน หรือสองเครื่องพร้อมกัน ได้คนชุดเดียวกันลงสองคอร์ต)
-- add_player    ชื่อที่มีในรายชื่อแล้วไม่เขียนทับระดับมือใน master อีก และกันชื่อซ้ำในวันเดียวกัน
--               (รวมแขกขาจร)
-- start_match   นับเฉพาะแถวที่ยังมีผู้เล่นจริง (player_id ไม่ใช่ null)
-- fill_match    ใหม่: เติมที่ว่างในเกมที่ยังไม่เริ่มด้วยคนแรกในคิว


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

grant execute on function fill_match(uuid) to authenticated;
