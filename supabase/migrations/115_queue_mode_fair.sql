-- ============================================================
-- 115 — โหมดคิวตัวที่สาม 'fair' (เน้นเล่นเท่ากัน)
-- ------------------------------------------------------------
-- เดิมมีสองโหมด: sequential (4 คนแรกในคิว) กับ rotate (เลี่ยงคู่ซ้ำ + บังคับพัก)
--
-- ปัญหาของ rotate: กติกาบังคับพักทำงานก่อนการเรียงตามจำนวนเกม เวลาคนแน่นคอร์ต
-- (เช่น 12 คน 2 คอร์ต) แทบไม่มีใครพักครบเกม ตัวตัดสินจริงจึงกลายเป็น
-- "ใครพักนานสุด" แทน "ใครเล่นน้อยสุด" — สองอย่างนี้มักไปทางเดียวกันแต่ไม่เท่ากัน
--
-- 'fair' คือ rotate ที่ตัดกติกาพักออก (= พฤติกรรมของ rotate ก่อน migration 113)
-- ยังเลี่ยงคู่ซ้ำเหมือนเดิม แค่ให้จำนวนเกมเป็นตัวตัดสินเดียว
--
-- ตรรกะจริงอยู่ฝั่ง client (src/utils/pairing.js) — ฐานข้อมูลแค่เก็บค่าที่เลือก
-- ไฟล์นี้จึงมีแต่การขยาย check constraint ไม่มีของเดิมต้องแปลง
-- ============================================================

-- constraint เดิมประกาศไว้ในบรรทัดเดียวกับคอลัมน์ Postgres จึงตั้งชื่อให้เอง
-- ปกติได้ 'sessions_queue_mode_check' แต่ถ้าเคยมีชื่อชนกันจะเป็น _check1 _check2
-- ไล่หาจากตัวที่อ้างถึง queue_mode แทนการเดาชื่อ
do $fix$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.sessions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%queue_mode%'
  loop
    execute format('alter table sessions drop constraint %I', r.conname);
  end loop;
end
$fix$;

alter table sessions add constraint sessions_queue_mode_check
  check (queue_mode in ('sequential', 'rotate', 'fair'));
