-- ============================================================
-- 105 — ให้คนที่ถูกเชิญมาเป็นผู้จัดก๊วน แก้ข้อมูลหลักของเจ้าของก๊วนได้
-- ------------------------------------------------------------
-- เดิม: ข้อมูลหลัก (ผู้เล่น/สนาม/ยี่ห้อ/รุ่น) เจ้าของแก้ได้คนเดียว
-- คนที่ถูกแชร์ก๊วนมาได้แค่ "อ่าน" (policy shared can read ...)
--
-- แต่ add_player เขียนสมาชิกเข้ารายชื่อของ "เจ้าของก๊วน" อยู่แล้ว
-- แปลว่า editor เพิ่มคนหน้างานได้โดยปริยาย แต่กลับเข้าไปแก้ชื่อที่พิมพ์ผิด
-- ไม่ได้ — ไม่สอดคล้องกัน ไฟล์นี้เปิดสิทธิ์ให้ตรงกับที่ทำได้จริงอยู่แล้ว
--
-- สิทธิ์ลบยังสงวนไว้ให้เจ้าของคนเดียว เพราะลบรายชื่อทิ้งกู้กลับไม่ได้
-- และกระทบทุกก๊วนของเจ้าของ ไม่ใช่แค่ก๊วนที่ editor คนนั้นดูแลอยู่
-- ============================================================

-- ------------------------------------------------------------
-- helper: แก้ข้อมูลหลักของ p_owner_id ได้ไหม
-- ต่างจาก has_master_access ตรงที่ต้องมีบทบาท owner/editor ในก๊วน
-- ของเจ้าของคนนั้น (viewer อ่านได้อย่างเดียวเหมือนเดิม)
-- ------------------------------------------------------------
create or replace function has_master_edit_access(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner_id = auth.uid() or exists (
    select 1 from clubs c
    join club_access a on a.club_id = c.id
    where c.owner_id = p_owner_id
      and a.user_id = auth.uid()
      and a.role in ('owner', 'editor')
  );
$$;

grant execute on function has_master_edit_access(uuid) to authenticated;


-- ------------------------------------------------------------
-- members / venues / shuttle_brands
-- เพิ่ม policy แยกสำหรับ insert กับ update เท่านั้น — ไม่แตะ delete
-- (policy "manage own ..." เดิมยังคุม delete ให้เจ้าของอยู่)
-- ------------------------------------------------------------
drop policy if exists "shared can add members" on members;
create policy "shared can add members" on members
  for insert with check (has_master_edit_access(owner_id));

drop policy if exists "shared can update members" on members;
create policy "shared can update members" on members
  for update using (has_master_edit_access(owner_id))
  with check (has_master_edit_access(owner_id));

drop policy if exists "shared can add venues" on venues;
create policy "shared can add venues" on venues
  for insert with check (has_master_edit_access(owner_id));

drop policy if exists "shared can update venues" on venues;
create policy "shared can update venues" on venues
  for update using (has_master_edit_access(owner_id))
  with check (has_master_edit_access(owner_id));

drop policy if exists "shared can add shuttle brands" on shuttle_brands;
create policy "shared can add shuttle brands" on shuttle_brands
  for insert with check (has_master_edit_access(owner_id));

drop policy if exists "shared can update shuttle brands" on shuttle_brands;
create policy "shared can update shuttle brands" on shuttle_brands
  for update using (has_master_edit_access(owner_id))
  with check (has_master_edit_access(owner_id));


-- ------------------------------------------------------------
-- shuttle_models — ไม่มี owner_id ของตัวเอง ต้องมองผ่านยี่ห้อแม่
-- ------------------------------------------------------------
drop policy if exists "shared can add shuttle models" on shuttle_models;
create policy "shared can add shuttle models" on shuttle_models
  for insert
  with check (exists (
    select 1 from shuttle_brands b
    where b.id = brand_id and has_master_edit_access(b.owner_id)
  ));

drop policy if exists "shared can update shuttle models" on shuttle_models;
create policy "shared can update shuttle models" on shuttle_models
  for update
  using (exists (
    select 1 from shuttle_brands b
    where b.id = brand_id and has_master_edit_access(b.owner_id)
  ))
  with check (exists (
    select 1 from shuttle_brands b
    where b.id = brand_id and has_master_edit_access(b.owner_id)
  ));
