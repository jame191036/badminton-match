-- ============================================================
-- 102 — ให้ v_member_stats ส่ง note ออกมาด้วย
-- ------------------------------------------------------------
-- คอลัมน์ members.note มีอยู่ในตารางตั้งแต่แรกแล้ว แต่ view ไม่ได้ดึงออกมา
-- หน้าข้อมูลหลักอ่านรายชื่อผู้เล่นผ่าน view นี้ (เพื่อเอาสถิติมาด้วย)
-- จึงมองไม่เห็น note — แก้ view อย่างเดียว ไม่ต้องแตะตาราง
--
-- venues / shuttle_brands ไม่ต้องแก้ เพราะอ่านจากตารางตรงๆ ด้วย select *
-- ============================================================

-- ต้อง drop ก่อน ไม่ใช่ create or replace เฉยๆ
-- เพราะ replace แก้ได้แค่ "ต่อท้าย" คอลัมน์ ถ้าแทรกกลางชุดจะขึ้น
-- ERROR 42P16: cannot change name of view column
-- (drop view ไม่ลบข้อมูล — view เป็นแค่สูตรคำนวณจากตาราง)
drop view if exists v_member_stats;

create view v_member_stats as
select
  mb.id      as member_id,
  mb.owner_id,
  mb.name,
  mb.default_skill,
  mb.note,
  mb.active,
  -- นับเฉพาะวันที่ join ติด (s.status = 'done') ไม่ใช่ทุกวันที่ลงชื่อไว้
  count(distinct s.id)                                            as days_played,
  coalesce(sum(p.games_played) filter (where s.id is not null), 0) as total_games,
  (
    select round(coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60)
    from players p2
    join match_players mp on mp.player_id = p2.id
    join matches m on m.id = mp.match_id and m.status = 'done' and m.started_at is not null
    where p2.member_id = mb.id
  ) as total_minutes,
  max(s.play_date) as last_played_on
from members mb
left join players p on p.member_id = mb.id and p.status <> 'absent'
left join sessions s on s.id = p.session_id and s.status = 'done'
group by mb.id;

-- *** สำคัญ: drop แล้วสร้างใหม่ทำให้ค่านี้หายไป ต้องตั้งใหม่ทุกครั้ง ***
-- ถ้าไม่ตั้ง view จะรันด้วยสิทธิ์เจ้าของ view = ข้าม RLS
-- แปลว่าใครก็ตามที่ล็อกอินอยู่จะอ่านรายชื่อผู้เล่นของคนอื่นได้
alter view v_member_stats set (security_invoker = on);
