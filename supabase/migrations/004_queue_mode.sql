-- ============================================================
-- 004 — โหมดจัดคิว: ตามลำดับ / สลับไม่ให้เจอคู่เดิม
-- ------------------------------------------------------------
-- sequential = ของเดิม เอา 4 คนแรกในคิว (เล่นน้อยสุด แล้วรอนานสุด)
-- rotate     = ดูคนในคิวกว้างขึ้นแล้วเลือกชุดที่ซ้ำคู่เดิมน้อยที่สุด
--
-- ตัวเลือกอยู่ที่ sessions เพราะเป็นการตั้งค่าของก๊วน ไม่ใช่ของผู้เล่น
-- ส่วน logic การเลือกจริงอยู่ใน src/utils/pairing.js (pure function)
-- DB มีหน้าที่แค่จำค่าที่เลือก กับให้สถิติคู่ที่เคยเจอกัน
--
-- รันไฟล์นี้ใน Supabase SQL editor ต่อจาก 003
-- ============================================================

alter table sessions
  add column if not exists queue_mode text not null default 'sequential'
    check (queue_mode in ('sequential', 'rotate'));


-- ------------------------------------------------------------
-- ประวัติการเจอกันของผู้เล่นแต่ละคู่ในก๊วน
-- together_count = เคยอยู่ทีมเดียวกันกี่เกม
-- against_count  = เคยอยู่คนละทีมกี่เกม
--
-- เก็บคู่ละแถวเดียว โดยให้ player_a < player_b เสมอ (uuid เทียบกันได้)
-- นับเฉพาะแมตช์ที่จบแล้ว — แมตช์ที่ถูกยกเลิกไม่นับ เพราะไม่ได้เล่นจริง
-- ------------------------------------------------------------
create or replace view v_pair_history as
select
  m.session_id,
  a.player_id as player_a,
  b.player_id as player_b,
  count(*) filter (where a.team =  b.team) as together_count,
  count(*) filter (where a.team <> b.team) as against_count
from match_players a
join match_players b
  on b.match_id = a.match_id
 and a.player_id < b.player_id
join matches m on m.id = a.match_id
where m.status = 'done'
group by m.session_id, a.player_id, b.player_id;

alter view v_pair_history set (security_invoker = on);
