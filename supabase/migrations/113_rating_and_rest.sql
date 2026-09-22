-- 113: rating ความเก่งจากแต้มจริง (Elo) + จับคู่ให้สูสี + บังคับพัก 1 เกม
--
-- members.rating / rated_games   rating ต่อคน ข้ามทุกก๊วน (null = ยังใช้ค่าจากระดับมือ)
-- match_players.rating_delta     ที่เกมนี้ให้/หัก เก็บไว้ถอนตอนแก้แต้ม
-- clubs.show_rating              ให้สมาชิกเห็นตัวเลข rating ไหม
-- skill_rating()                 ระดับมือ -> rating ตั้งต้น
-- apply/revert_match_rating      เรียกจาก finish_match / set_match_score เท่านั้น
-- v_session_player_stats.rested  พักครบหนึ่งเกมแล้วหรือยัง (ใช้ตอนจับคู่)
-- v_club_ranking                 + rating, rated_games
-- v_my_clubs                     + show_rating

alter table members add column if not exists rating numeric(7, 2);
alter table members add column if not exists rated_games int not null default 0;
alter table clubs add column if not exists show_rating boolean not null default true;
alter table match_players add column if not exists rating_delta numeric(6, 2);

create or replace function skill_rating(p_skill int)
returns numeric
language sql
immutable
as $$ select 800 + 100 * p_skill::numeric $$;

create or replace view v_session_player_stats as
select
  p.id         as player_id,
  p.session_id,
  p.name,
  p.status,
  p.paying,
  count(m.id)                                                           as games,
  coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60 as minutes,
  -- แพ้/ชนะนับเฉพาะเกมที่กรอกแต้ม (ฝั่งเราแต้มมากกว่า = ชนะ)
  count(m.id) filter (where m.score_a is not null and (mp.team = 'A') =  (m.score_a > m.score_b)) as wins,
  count(m.id) filter (where m.score_a is not null and (mp.team = 'A') <> (m.score_a > m.score_b)) as losses,
  coalesce(sum(case when mp.team = 'A' then m.score_a - m.score_b else m.score_b - m.score_a end)
           filter (where m.score_a is not null), 0) as point_diff,
  -- พักครบหนึ่งเกมแล้วหรือยัง: หลังจบเกมล่าสุดของเรา ต้องมีเกมอื่นที่จับคู่
  -- หลังจากนั้นและเล่นจบไปแล้วหนึ่งเกม (ยังไม่เคยเล่น = พักครบ)
  max(m.ended_at) is null or exists (
    select 1 from matches m2
    where m2.session_id = p.session_id and m2.status = 'done' and m2.created_at > max(m.ended_at)
  ) as rested
from players p
left join match_players mp on mp.player_id = p.id
left join matches m
  on m.id = mp.match_id
 and m.status = 'done'
 and m.started_at is not null
group by p.id;

-- เพิ่มคอลัมน์กลาง view ต้อง drop ก่อน
drop view if exists v_club_ranking;

create or replace view v_club_ranking as
select
  s.club_id,
  mb.id   as member_id,
  mb.name,
  coalesce(mb.rating, skill_rating(mb.default_skill)) as rating,
  mb.rated_games,
  count(*)                                                        as games,
  count(*) filter (where (mp.team = 'A') =  (m.score_a > m.score_b)) as wins,
  count(*) filter (where (mp.team = 'A') <> (m.score_a > m.score_b)) as losses,
  sum(case when mp.team = 'A' then m.score_a - m.score_b else m.score_b - m.score_a end) as point_diff
from match_players mp
join matches m  on m.id = mp.match_id and m.status = 'done' and m.score_a is not null
join sessions s on s.id = m.session_id
join players p  on p.id = mp.player_id
join members mb on mb.id = p.member_id
group by s.club_id, mb.id, mb.name, mb.rating, mb.default_skill, mb.rated_games;

alter view v_club_ranking set (security_invoker = on);

create or replace view v_my_clubs as
select
  c.id,
  c.owner_id,
  c.name,
  c.note,
  c.active,
  c.created_at,
  a.role,
  (c.owner_id = auth.uid()) as is_mine,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'done')    as done_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'planned')   as planned_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'cancelled') as cancelled_days,
  (select count(*) from sessions s where s.club_id = c.id)                            as total_days,
  (select s.id from sessions s where s.club_id = c.id and s.status = 'playing' limit 1) as playing_session_id,
  (select max(s.play_date) from sessions s where s.club_id = c.id and s.status = 'done') as last_played_on,
  (select min(s.play_date) from sessions s
    where s.club_id = c.id and s.status = 'planned' and s.play_date >= current_date) as next_play_date,
  c.show_rating
from clubs c
join club_access a on a.club_id = c.id and a.user_id = auth.uid();

create or replace function apply_match_rating(p_match_id uuid)
returns void
language plpgsql
as $$
declare
  v_m matches%rowtype;
  v_ra numeric;
  v_rb numeric;
  v_expect numeric;
  v_actual numeric;
  v_minutes numeric;
  v_median numeric;
  v_others int;
begin
  select * into v_m from matches where id = p_match_id;
  if v_m.score_a is null or v_m.started_at is null or v_m.ended_at is null then
    return;
  end if;

  v_minutes := extract(epoch from (v_m.ended_at - v_m.started_at)) / 60;
  if v_minutes < 3 then
    return;
  end if;

  select
    avg(coalesce(mb.rating, skill_rating(mp.skill))) filter (where mp.team = 'A'),
    avg(coalesce(mb.rating, skill_rating(mp.skill))) filter (where mp.team = 'B')
  into v_ra, v_rb
  from match_players mp
  left join players p  on p.id = mp.player_id
  left join members mb on mb.id = p.member_id
  where mp.match_id = p_match_id;

  v_expect := 1 / (1 + power(10, (v_rb - v_ra) / 400));
  v_actual := 0.5 + 0.5 * (v_m.score_a - v_m.score_b)::numeric / greatest(v_m.score_a, v_m.score_b);

  select count(*), percentile_cont(0.5) within group (order by extract(epoch from (ended_at - started_at)) / 60)
  into v_others, v_median
  from matches
  where session_id = v_m.session_id and id <> p_match_id and status = 'done'
    and score_a is not null and ended_at - started_at >= interval '3 minutes';

  if v_others >= 3 and v_minutes >= 1.25 * v_median and abs(v_m.score_a - v_m.score_b) <= 4 then
    v_actual := 0.5 + (v_actual - 0.5) * 0.5;
  end if;

  update match_players mp
  set rating_delta = round(
        (case when mb.rated_games < 10 then 48 else 32 end)
        * (case when mp.team = 'A' then v_actual - v_expect else v_expect - v_actual end), 2)
  from players p
  join members mb on mb.id = p.member_id
  where mp.match_id = p_match_id and p.id = mp.player_id;

  update members mb
  set rating = coalesce(mb.rating, skill_rating(mb.default_skill)) + mp.rating_delta,
      rated_games = mb.rated_games + 1
  from match_players mp
  join players p on p.id = mp.player_id
  where mp.match_id = p_match_id and mp.rating_delta is not null and mb.id = p.member_id;
end;
$$;
create or replace function revert_match_rating(p_match_id uuid)
returns void
language plpgsql
as $$
begin
  update members mb
  set rating = mb.rating - mp.rating_delta,
      rated_games = greatest(mb.rated_games - 1, 0)
  from match_players mp
  join players p on p.id = mp.player_id
  where mp.match_id = p_match_id and mp.rating_delta is not null and mb.id = p.member_id;

  update match_players set rating_delta = null where match_id = p_match_id;
end;
$$;
revoke execute on function apply_match_rating(uuid) from public, anon, authenticated;
revoke execute on function revert_match_rating(uuid) from public, anon, authenticated;

create or replace function finish_match(
  p_match_id uuid,
  p_score_a int default null,
  p_score_b int default null
)
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

  perform assert_valid_score(p_score_a, p_score_b);

  update matches
  set ended_at = now(), status = 'done', score_a = p_score_a, score_b = p_score_b
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

  perform apply_match_rating(p_match_id);
end;
$$;
create or replace function set_match_score(p_match_id uuid, p_score_a int, p_score_b int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  select m.session_id into v_session_id
  from matches m join sessions s on s.id = m.session_id
  where m.id = p_match_id and m.status = 'done' and s.status = 'playing';

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'แก้แต้มไม่ได้ — ต้องเป็นเกมที่จบแล้วในวันที่ยังเล่นอยู่ และต้องมีสิทธิ์จัดก๊วนนี้';
  end if;

  perform assert_valid_score(p_score_a, p_score_b);

  perform revert_match_rating(p_match_id);
  update matches set score_a = p_score_a, score_b = p_score_b where id = p_match_id;
  perform apply_match_rating(p_match_id);
end;
$$;