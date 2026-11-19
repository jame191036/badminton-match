-- ============================================================
-- 119 — เอาระบบนับแต้มออกทั้งหมด + เวลาจบเกมล่าสุดให้กติกาพัก
-- ------------------------------------------------------------
-- *** ลบข้อมูลแต้มของทุกเกมและ rating ของสมาชิกทุกคนทิ้งถาวร กู้คืนไม่ได้ ***
-- (จำนวนเกม เวลาเล่น ประวัติว่าใครเจอใคร และยอดเงิน ยังอยู่ครบ)
--
-- เอาออก (ย้อน 112 และส่วน rating ของ 113):
--   matches.score_a / score_b      แต้มของเกม
--   members.rating / rated_games   rating แบบ Elo ที่เรียนรู้จากแต้ม
--   match_players.rating_delta     rating ที่แต่ละเกมให้/หัก
--   clubs.show_rating              สวิตช์ให้สมาชิกเห็นเลข rating
--   set_match_score, assert_valid_score, apply/revert_match_rating, skill_rating
--   v_club_ranking                 แท็บอันดับของก๊วน
--   finish_match(uuid, int, int)   -> finish_match(uuid) รับแค่ match
--
-- เพิ่ม:
--   v_session_player_stats.last_ended_at  เวลาจบเกมล่าสุดของแต่ละคน
--     คนที่จบเกมเดียวกันได้ค่าเดียวกันพอดี กติกาพักฝั่งแอปใช้แยก "พักมาเท่ากัน"
--     ออกจาก "พักมานานกว่า" — เดิมใช้ queue_seq ซึ่ง finish_match แจกให้สี่คน
--     ตามลำดับแถวในตาราง ลำดับเดิมทุกครั้ง คนกลุ่มเดิมจึงถูกดึงกลับลงคอร์ต
--     ติดกันทุกเกม (จำลอง 10 คน 2 คอร์ต: ได้เล่น 11 เกม vs 6 เกม)
--
-- ส่วนบังคับพักทั้งหมด (rested) ของ 113 คงไว้เหมือนเดิม
-- ทั้งไฟล์อยู่ใน transaction เดียว พังกลางทางจะไม่เหลือครึ่ง ๆ กลาง ๆ
-- ============================================================

begin;

-- view ที่อ้างคอลัมน์ที่จะลบต้อง drop ก่อน (create or replace ลบคอลัมน์ไม่ได้)
drop view if exists v_club_ranking;
drop view if exists v_match_history;
drop view if exists v_session_player_stats;
drop view if exists v_my_clubs;

-- set_match_score เรียก apply/revert_match_rating -> drop ตัวเรียกก่อน
drop function if exists set_match_score(uuid, int, int);
drop function if exists finish_match(uuid, int, int);
drop function if exists apply_match_rating(uuid);
drop function if exists revert_match_rating(uuid);
drop function if exists assert_valid_score(int, int);
drop function if exists skill_rating(int);

alter table matches drop constraint if exists matches_score_both;
alter table matches drop constraint if exists matches_score_no_tie;
alter table matches
  drop column if exists score_a,
  drop column if exists score_b;
alter table match_players drop column if exists rating_delta;
alter table members
  drop column if exists rating,
  drop column if exists rated_games;
alter table clubs drop column if exists show_rating;

create or replace view v_match_history as
select
  m.id,
  m.session_id,
  m.court_name,
  m.started_at,
  m.ended_at,
  array_agg(mp.player_name) filter (where mp.team = 'A') as team_a_names,
  array_agg(mp.player_name) filter (where mp.team = 'B') as team_b_names
from matches m
join match_players mp on mp.match_id = m.id
where m.ended_at is not null
group by m.id
order by m.ended_at desc;

create or replace view v_session_player_stats as
select
  p.id         as player_id,
  p.session_id,
  p.name,
  p.status,
  p.paying,
  count(m.id)                                                           as games,
  coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60 as minutes,
  -- พักครบหนึ่งเกมแล้วหรือยัง: หลังจบเกมล่าสุดของเรา ต้องมีเกมอื่นที่จับคู่
  -- หลังจากนั้นและเล่นจบไปแล้วหนึ่งเกม (ยังไม่เคยเล่น = พักครบ)
  max(m.ended_at) is null or exists (
    select 1 from matches m2
    where m2.session_id = p.session_id and m2.status = 'done' and m2.created_at > max(m.ended_at)
  ) as rested,
  -- เวลาจบเกมล่าสุด — คนที่จบเกมเดียวกันได้ค่าเดียวกันพอดี กติกาพักฝั่งแอปใช้แยก
  -- "พักมานานเท่ากัน" ออกจาก "พักมานานกว่า" (queue_seq แยกไม่ได้ ดู finish_match)
  max(m.ended_at) as last_ended_at
from players p
left join match_players mp on mp.player_id = p.id
left join matches m
  on m.id = mp.match_id
 and m.status = 'done'
 and m.started_at is not null
group by p.id;

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
  c.promptpay_id,
  c.promptpay_name
from clubs c
join club_access a on a.club_id = c.id and a.user_id = auth.uid();

-- view ที่สร้างใหม่ต้องเปิด security_invoker ทุกตัว ไม่งั้น RLS ไม่มีผล
alter view v_match_history        set (security_invoker = on);
alter view v_session_player_stats set (security_invoker = on);
alter view v_my_clubs             set (security_invoker = on);

-- ------------------------------------------------------------
-- จบเกม: เหมือนเดิมทุกอย่าง แค่ไม่รับแต้มและไม่คิด rating
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

grant execute on function finish_match(uuid) to authenticated;

commit;
