-- ============================================================
-- 001 — คิดเงินตามชั่วโมงจริง
-- ------------------------------------------------------------
-- เดิม: sessions.court_fee / sessions.shuttle_fee เป็นยอดรวมก้อนเดียว
-- ใหม่: ค่าสนามคำนวณจาก (ชั่วโมงของแต่ละคอร์ต × ราคาต่อชั่วโมง)
--       ค่าลูกคำนวณจาก (จำนวนลูก × ราคาต่อลูก)
--
-- วิธีหารยังเหมือนเดิม: ยอดรวม / จำนวนคนที่ร่วมจ่าย (เท่ากันทุกคน)
-- รันไฟล์นี้ใน Supabase SQL editor กับฐานข้อมูลที่มีอยู่แล้ว
-- (schema.sql ถูกอัปเดตให้ตรงกันแล้ว สำหรับกรณีสร้างฐานใหม่)
-- ============================================================

-- ราคาต่อชั่วโมงใช้ร่วมกันทุกคอร์ตในก๊วนเดียวกัน
-- (ถ้าวันหน้าคอร์ตคนละราคา ค่อยย้ายฟิลด์นี้ไปไว้ที่ courts)
alter table sessions
  add column if not exists hourly_rate   numeric(10,2) not null default 0 check (hourly_rate >= 0),
  add column if not exists shuttle_price numeric(10,2) not null default 0 check (shuttle_price >= 0),
  add column if not exists shuttle_count int           not null default 0 check (shuttle_count >= 0);

-- 1 แถวคอร์ต = 1 การจอง จึงเก็บชั่วโมงไว้ที่คอร์ตได้เลย
-- รองรับกรณีจอง 2 สนาม สนามแรก 3 ชม. สนามสอง 2 ชม.
alter table courts
  add column if not exists hours numeric(5,2) not null default 0 check (hours >= 0);

-- ย้ายค่าลูกก้อนเดิมมาเป็น "1 ลูก ราคาเท่ากับยอดเดิม"
update sessions
set shuttle_price = shuttle_fee,
    shuttle_count = 1
where shuttle_fee > 0 and shuttle_count = 0;

-- ค่าสนามเดิมแตกเป็น (ชั่วโมง × ราคาต่อชั่วโมง) อัตโนมัติไม่ได้ — ยอดรวมก้อนเดียว
-- เช่น 900 บาท จะเป็น 2 คอร์ต × 3 ชม. × 150 หรือ 1 คอร์ต × 6 ชม. × 150 ก็ได้
-- จึงไม่ลบทิ้ง แต่ rename เก็บไว้เป็นข้อมูลอ้างอิง (ไม่มีโค้ดฝั่งแอปอ่านแล้ว)
-- ดูยอดเดิมได้ด้วย: select name, legacy_court_fee, legacy_shuttle_fee from sessions;
-- เมื่อกรอกชั่วโมง/ราคาใหม่ครบและมั่นใจแล้ว ค่อยลบด้วย 002 ทีหลัง
alter table sessions rename column court_fee to legacy_court_fee;
alter table sessions rename column shuttle_fee to legacy_shuttle_fee;

alter table sessions alter column legacy_court_fee drop not null;
alter table sessions alter column legacy_shuttle_fee drop not null;
comment on column sessions.legacy_court_fee is
  'ยอดค่าสนามรวมแบบเก่า ก่อนเปลี่ยนมาคิดตามชั่วโมง — เก็บไว้อ้างอิงเท่านั้น ลบได้เมื่อไม่ต้องใช้';
comment on column sessions.legacy_shuttle_fee is
  'ยอดค่าลูกรวมแบบเก่า — ย้ายไปเป็น shuttle_price แล้ว เก็บไว้อ้างอิงเท่านั้น';


-- ------------------------------------------------------------
-- สรุปค่าใช้จ่าย — รวมยอดแบบใหม่ แต่ยังหารเท่ากันทุกคนที่ร่วมจ่าย
-- ------------------------------------------------------------
drop view if exists v_billing_summary;

create view v_billing_summary as
with court_totals as (
  select session_id, coalesce(sum(hours), 0) as total_hours
  from courts
  group by session_id
),
payer_totals as (
  select session_id, count(*) filter (where paying) as payer_count
  from players
  group by session_id
)
select
  s.id as session_id,
  s.hourly_rate,
  coalesce(c.total_hours, 0)                          as total_hours,
  round(coalesce(c.total_hours, 0) * s.hourly_rate, 2) as court_total,
  s.shuttle_count,
  s.shuttle_price,
  round(s.shuttle_count * s.shuttle_price, 2)          as shuttle_total,
  round(coalesce(c.total_hours, 0) * s.hourly_rate + s.shuttle_count * s.shuttle_price, 2) as total_fee,
  coalesce(p.payer_count, 0) as payer_count,
  case
    when coalesce(p.payer_count, 0) > 0
      then round(
        (coalesce(c.total_hours, 0) * s.hourly_rate + s.shuttle_count * s.shuttle_price)
        / p.payer_count, 2)
    else 0
  end as per_person
from sessions s
left join court_totals c on c.session_id = s.id
left join payer_totals p on p.session_id = s.id;
