-- ============================================================
-- 118 — วิธีจับคู่แบบที่สาม: variety (เน้นไม่ซ้ำคู่)
-- ------------------------------------------------------------
-- สองโหมดเดิมเอา "จำนวนเกม" มาก่อนเสมอ แล้วใช้คะแนนคู่ซ้ำเป็นตัวตัดสินรอง
-- โหมดนี้กลับลำดับ: เอาความหลากหลายของคู่มาก่อน ยอมให้จำนวนเกมไม่เท่ากัน
-- และไม่ใช้สวิตช์บังคับพักเลย (กติกาพักบีบตัวเลือกเหลือ 4 คนพอดี
-- ซึ่งทำลายสิ่งที่โหมดนี้มีอยู่เพื่อมัน)
--
-- ตรรกะอยู่ฝั่ง client ทั้งหมด (src/utils/pairing.js -> pickVariety)
-- ฐานข้อมูลแค่เก็บค่าที่เลือก ไฟล์นี้จึงมีแต่การขยาย check constraint
-- ============================================================

-- ไล่หาชื่อ constraint เองเหมือน 115/116 ไม่เดา
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
  check (queue_mode in ('sequential', 'rotate', 'variety'));
