-- ============================================================
-- 003 — สถิติผู้เล่นและสรุปก๊วน
-- ------------------------------------------------------------
-- ตอนนี้ matches มี started_at/ended_at ครบแล้ว (จาก 002) จึงคิด
-- "เล่นไปกี่นาที" ได้จริง โดยไม่ต้องเก็บข้อมูลซ้ำ — ทำเป็น view ล้วน
--
-- หมายเหตุ: ยอดเงินในนี้คำนวณสดจากเรทปัจจุบัน เหมาะกับก๊วนที่กำลัง
-- เล่นอยู่ แต่ถ้าวันหน้าทำหลายก๊วน/ประวัติข้ามครั้ง ต้อง freeze ยอด
-- ตอนปิดก๊วน ไม่งั้นแก้เรทแล้วประวัติเก่าจะเปลี่ยนยอดตามไปด้วย
--
-- รันไฟล์นี้ใน Supabase SQL editor ต่อจาก 002
-- ============================================================

-- ------------------------------------------------------------
-- สถิติรายคนในก๊วน: เล่นกี่เกม กี่นาที
-- นับเฉพาะแมตช์ที่จบแล้ว (status = 'done')
-- คนที่ถูกสลับตัวออกก่อนเริ่มไม่มีแถวใน match_players จึงไม่ถูกนับเอง
-- ------------------------------------------------------------
create or replace view v_session_player_stats as
select
  p.id                as player_id,
  p.session_id,
  p.name,
  p.status,
  p.paying,
  count(m.id)                                                          as games,
  coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60 as minutes
from players p
left join match_players mp on mp.player_id = p.id
left join matches m
  on m.id = mp.match_id
 and m.status = 'done'
 and m.started_at is not null
group by p.id;

-- ------------------------------------------------------------
-- สรุปภาพรวมของก๊วน
-- ------------------------------------------------------------
create or replace view v_session_summary as
select
  s.id as session_id,
  (select count(*) from players p where p.session_id = s.id)               as player_count,
  (select count(*) from courts c where c.session_id = s.id)                as court_count,
  (select coalesce(sum(c.hours), 0) from courts c where c.session_id = s.id) as booked_hours,
  (select count(*) from matches m where m.session_id = s.id and m.status = 'done') as finished_games,
  (select coalesce(sum(extract(epoch from (m.ended_at - m.started_at))), 0) / 60
     from matches m
    where m.session_id = s.id and m.status = 'done' and m.started_at is not null) as total_play_minutes
from sessions s;


-- ============================================================
-- security_invoker — ให้ view เคารพ RLS ของตารางข้างใต้
-- ------------------------------------------------------------
-- โดยปกติ view จะรันด้วยสิทธิ์ของเจ้าของ view (postgres) ซึ่ง "ข้าม" RLS
-- แปลว่าถ้ารู้ session_id ของคนอื่น ก็ query ผ่าน view ได้ทั้งที่ไม่ใช่ก๊วนตัวเอง
-- เปิด security_invoker ให้ view ใช้สิทธิ์ของคนเรียกแทน RLS จึงมีผลจริง
-- (รวม view เดิมที่มีปัญหาเดียวกันอยู่ด้วย)
-- ============================================================
alter view v_session_player_stats set (security_invoker = on);
alter view v_session_summary      set (security_invoker = on);
alter view v_match_history        set (security_invoker = on);
alter view v_billing_summary      set (security_invoker = on);
alter view v_waiting_queue        set (security_invoker = on);
alter view v_court_board          set (security_invoker = on);
