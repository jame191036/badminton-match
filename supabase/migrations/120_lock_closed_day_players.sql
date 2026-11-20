-- ============================================================
-- 120 — ล็อกรายชื่อคนจ่ายของวันที่จบแล้ว
-- ------------------------------------------------------------
-- close_session ล็อกยอดเงิน (final_*) ไว้แล้ว แต่รายชื่อคนค้างจ่าย
-- (v_club_outstanding) ยังอ่าน players.status / paying สด ๆ และ
-- set_player_attendance กับการ update players ตรง ๆ ยังทำได้หลังจบวัน
-- → แก้ "มา/ไม่มา" หรือ "แขกไม่จ่าย" ทีหลัง ยอดค้างจ่ายรวมจะไม่เท่ายอดที่ล็อก
--   (ทดสอบ: วันที่ล็อกไว้ 810 กลายเป็นค้าง 972 หรือ 648)
-- หน้าจอกันไว้แล้ว (วันที่จบแล้วเป็นแบบอ่านอย่างเดียว) เหลือช่องจาก
-- มือถืออีกเครื่องที่ค้างหน้าเก่าไว้ตอนเน็ตหลุด
--
-- ต่อจากนี้ ผู้เล่นของวันที่จบแล้วแก้ได้แค่:
--   paid_at    ติ๊กจ่ายเงิน (ส่วนใหญ่โอนกันหลังเลิกเล่น)
--   member_id  ระบบตั้งเป็น null เองตอนลบสมาชิกออกจากรายชื่อหลัก
-- เพิ่ม/ลบผู้เล่นของวันที่จบแล้วไม่ได้ — ยกเว้นตอนลบทั้งวัน/ทั้งก๊วน (cascade)
--
-- ไม่แตะข้อมูลเดิม · รันซ้ำได้ · ทั้งไฟล์อยู่ใน transaction เดียว
-- ============================================================

begin;

-- ไม่เจอแถว session = กำลังลบทั้งวัน/ทั้งก๊วนอยู่ (cascade) ปล่อยผ่าน
-- security definer: ต้องเห็นสถานะวันเสมอ ไม่ให้ RLS ซ่อนแถวแล้วหลุดการตรวจ
create or replace function lock_closed_day_players()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from sessions where id = old.session_id and status = 'done') then
      raise exception 'วันเล่นนี้จบแล้ว ลบผู้เล่นออกไม่ได้';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from sessions where id = new.session_id and status = 'done') then
      raise exception 'วันเล่นนี้จบแล้ว เพิ่มผู้เล่นไม่ได้';
    end if;
    return new;
  end if;

  -- UPDATE: แถวเดิมอยู่ในวันที่จบแล้ว หรือกำลังถูกย้ายเข้าวันที่จบแล้ว
  if exists (
    select 1 from sessions
    where id in (old.session_id, new.session_id) and status = 'done'
  ) and to_jsonb(new) - '{paid_at,member_id,updated_at}'::text[]
        is distinct from to_jsonb(old) - '{paid_at,member_id,updated_at}'::text[] then
    raise exception 'วันเล่นนี้จบแล้ว แก้ได้เฉพาะสถานะจ่ายเงิน';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_players_lock_closed_day on players;

create trigger trg_players_lock_closed_day
  before insert or update or delete on players
  for each row execute function lock_closed_day_players();

commit;
