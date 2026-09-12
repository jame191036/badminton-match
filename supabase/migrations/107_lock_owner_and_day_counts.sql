-- ============================================================
-- 107 — อุดช่องโหว่ "ยึดข้อมูลหลัก" + เพิ่มตัวนับวันเล่นให้ครบทุกสถานะ
-- ============================================================

-- ------------------------------------------------------------
-- 1. ช่องโหว่: ผู้ร่วมจัดก๊วนยึดข้อมูลหลักของเจ้าของไปเป็นของตัวเองได้
-- ------------------------------------------------------------
-- policy "shared can update ..." เช็ค has_master_edit_access(owner_id)
-- ทั้งใน USING และ WITH CHECK
--
-- USING เช็คแถวเดิม (owner_id = เจ้าของก๊วน) -> ผ่าน เพราะเป็น editor
-- WITH CHECK เช็คแถวใหม่ ถ้า editor สั่ง UPDATE ... SET owner_id = ตัวเอง
-- ก็ยังผ่าน เพราะ has_master_edit_access(ตัวเอง) คืน true เสมอ
-- ผลคือย้ายผู้เล่น/สนาม/ยี่ห้อของคนอื่นมาเป็นของตัวเองถาวร เจ้าของเดิมหาย
--
-- RLS อ้างถึงค่าเดิม (OLD) ใน WITH CHECK ไม่ได้ จึงต้องกันด้วย trigger
-- ซึ่งเห็นทั้ง OLD และ NEW
create or replace function lock_master_owner()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'เปลี่ยนเจ้าของข้อมูลหลักไม่ได้';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_members_lock_owner on members;
create trigger trg_members_lock_owner
  before update on members
  for each row execute function lock_master_owner();

drop trigger if exists trg_venues_lock_owner on venues;
create trigger trg_venues_lock_owner
  before update on venues
  for each row execute function lock_master_owner();

drop trigger if exists trg_shuttle_brands_lock_owner on shuttle_brands;
create trigger trg_shuttle_brands_lock_owner
  before update on shuttle_brands
  for each row execute function lock_master_owner();

-- shuttle_models ไม่มี owner_id แต่ย้าย brand_id ไปยี่ห้อของตัวเองได้ ซึ่งคือ
-- การยึดแบบเดียวกัน (policy เช็คผ่านยี่ห้อแม่ ทั้งของเดิมและของใหม่จึงผ่านทั้งคู่)
create or replace function lock_model_brand()
returns trigger
language plpgsql
as $$
begin
  if new.brand_id is distinct from old.brand_id then
    raise exception 'ย้ายรุ่นไปยี่ห้ออื่นไม่ได้';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shuttle_models_lock_brand on shuttle_models;
create trigger trg_shuttle_models_lock_brand
  before update on shuttle_models
  for each row execute function lock_model_brand();


-- ------------------------------------------------------------
-- 2. v_my_clubs: เพิ่มจำนวนวันที่ยกเลิกและจำนวนรวมทุกสถานะ
-- ------------------------------------------------------------
-- เดิมมีแค่ done_days กับ planned_days ทำให้
--   - คำเตือนตอนลบก๊วนนับวันที่ 'playing' และ 'cancelled' ไม่ครบ
--     (ก๊วนที่มี 1 วันกำลังเล่น + 4 วันยกเลิก จะขึ้นว่า "0 วันจะหายไป"
--      ทั้งที่ cascade ลบทั้ง 5 วัน)
--   - ตัวเลขบนแท็บ "ที่เล่นไปแล้ว" ไม่ตรงกับจำนวนแถวในตาราง เพราะตาราง
--     รวมวันที่ยกเลิกด้วย
drop view if exists v_my_clubs;

create view v_my_clubs as
select
  c.id,
  c.owner_id,
  c.name,
  c.note,
  c.active,
  c.created_at,
  a.role,
  (c.owner_id = auth.uid()) as is_mine,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'done')      as done_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'planned')   as planned_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'cancelled') as cancelled_days,
  (select count(*) from sessions s where s.club_id = c.id)                            as total_days,
  (select s.id from sessions s where s.club_id = c.id and s.status = 'playing' limit 1) as playing_session_id,
  (select max(s.play_date) from sessions s where s.club_id = c.id and s.status = 'done') as last_played_on,
  (select min(s.play_date) from sessions s
    where s.club_id = c.id and s.status = 'planned' and s.play_date >= current_date) as next_play_date
from clubs c
join club_access a on a.club_id = c.id and a.user_id = auth.uid();

-- *** drop แล้วสร้างใหม่ทำให้ค่านี้หาย ต้องตั้งใหม่เสมอ ***
-- ถ้าไม่ตั้ง view จะรันด้วยสิทธิ์เจ้าของ view = ข้าม RLS
alter view v_my_clubs set (security_invoker = on);
