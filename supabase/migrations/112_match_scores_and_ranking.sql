-- 112: บันทึกแต้มในเกม + อันดับแพ้/ชนะ
--
-- matches.score_a / score_b  ไม่บังคับกรอก แต้มเท่ากันไม่ได้ (แบดไม่มีเสมอ)
-- finish_match               รับแต้มได้ (ตัวเก่าที่รับแค่ match_id ถูก drop เพราะ
--                            ถ้าค้างไว้สองตัว PostgREST จะเลือกไม่ถูกว่าเรียกตัวไหน)
-- set_match_score            แก้แต้มย้อนหลังได้ ระหว่างวันที่ยังเล่นอยู่
-- v_session_player_stats     + wins / losses / point_diff
-- v_club_ranking             อันดับรวมทั้งก๊วน ต่อสมาชิก

alter table matches
  add column if not exists score_a smallint check (score_a between 0 and 99),
  add column if not exists score_b smallint check (score_b between 0 and 99);

alter table matches drop constraint if exists matches_score_both;
alter table matches add constraint matches_score_both check ((score_a is null) = (score_b is null));
alter table matches drop constraint if exists matches_score_no_tie;
alter table matches add constraint matches_score_no_tie check (score_a is null or score_a <> score_b);

-- เพิ่มคอลัมน์กลาง view ต้อง drop ก่อน (create or replace เพิ่มได้แค่ท้าย)
drop view if exists v_match_history;

create or replace view v_match_history as
select
  m.id,
  m.session_id,
  m.court_name,
  m.started_at,
  m.ended_at,
  m.score_a,
  m.score_b,
  array_agg(mp.player_name) filter (where mp.team = 'A') as team_a_names,
  array_agg(mp.player_name) filter (where mp.team = 'B') as team_b_names
from matches m
join match_players mp on mp.match_id = m.id
where m.ended_at is not null
group by m.id
order by m.ended_at desc;

alter view v_match_history set (security_invoker = on);

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
           filter (where m.score_a is not null), 0) as point_diff
from players p
left join match_players mp on mp.player_id = p.id
left join matches m
  on m.id = mp.match_id
 and m.status = 'done'
 and m.started_at is not null
group by p.id;

create or replace view v_club_ranking as
select
  s.club_id,
  mb.id   as member_id,
  mb.name,
  count(*)                                                        as games,
  count(*) filter (where (mp.team = 'A') =  (m.score_a > m.score_b)) as wins,
  count(*) filter (where (mp.team = 'A') <> (m.score_a > m.score_b)) as losses,
  sum(case when mp.team = 'A' then m.score_a - m.score_b else m.score_b - m.score_a end) as point_diff
from match_players mp
join matches m  on m.id = mp.match_id and m.status = 'done' and m.score_a is not null
join sessions s on s.id = m.session_id
join players p  on p.id = mp.player_id
join members mb on mb.id = p.member_id
group by s.club_id, mb.id, mb.name;

alter view v_club_ranking set (security_invoker = on);

create or replace function assert_valid_score(p_score_a int, p_score_b int)
returns void
language plpgsql
immutable
as $$
begin
  if (p_score_a is null) <> (p_score_b is null) then
    raise exception 'ใส่แต้มให้ครบทั้งสองฝั่ง หรือเว้นว่างทั้งคู่';
  end if;
  if p_score_a < 0 or p_score_b < 0 or p_score_a > 99 or p_score_b > 99 then
    raise exception 'แต้มต้องอยู่ระหว่าง 0 ถึง 99';
  end if;
  if p_score_a = p_score_b then
    raise exception 'แต้มเสมอกันไม่ได้ ต้องมีฝั่งที่ชนะ';
  end if;
end;
$$;
drop function if exists finish_match(uuid);

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

  update matches set score_a = p_score_a, score_b = p_score_b where id = p_match_id;
end;
$$;
grant execute on function finish_match(uuid, int, int) to authenticated;
grant execute on function set_match_score(uuid, int, int) to authenticated;
