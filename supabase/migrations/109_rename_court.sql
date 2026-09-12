-- ============================================================
-- 109 — เปลี่ยนชื่อคอร์ตหลังสร้างวันเล่นแล้ว
-- ------------------------------------------------------------
-- เดิมชื่อคอร์ตตั้งได้ตอนสร้างวันเล่นอย่างเดียว พอไปถึงสนามจริงแล้วรู้ว่า
-- ได้คอร์ต 7 กับ 8 ไม่ใช่ 1 กับ 2 ก็แก้ไม่ได้ ต้องจำเอาเองทั้งวัน
--
-- ทำไมต้องเป็น RPC ทั้งที่อัปเดตคอลัมน์เดียว:
-- matches.court_name เป็น snapshot ที่ถ่ายไว้ตอน assign_court เกมที่ยังเล่น
-- ไม่จบ (ended_at is null) ต้องเปลี่ยนตามไปด้วย ไม่งั้นพอจบเกมนั้น ประวัติ
-- จะขึ้นชื่อเก่า ส่วนเกมที่จบไปแล้วคงชื่อเดิมไว้ตามเจตนาของ snapshot —
-- ตอนนั้นคอร์ตชื่อนั้นจริง ๆ
-- ============================================================

create or replace function rename_court(p_court_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_status text;
  v_name text := trim(coalesce(p_name, ''));
begin
  select c.session_id, s.status into v_session_id, v_status
  from courts c join sessions s on s.id = c.session_id
  where c.id = p_court_id;

  if v_session_id is null or not can_edit_session(v_session_id) then
    raise exception 'ไม่พบคอร์ตนี้ หรือไม่มีสิทธิ์แก้ไข';
  end if;

  -- วันที่จบหรือยกเลิกไปแล้วห้ามแตะ ประวัติต้องนิ่ง
  if v_status not in ('planned', 'playing') then
    raise exception 'วันเล่นนี้จบหรือถูกยกเลิกไปแล้ว';
  end if;

  if char_length(v_name) = 0 then
    raise exception 'ต้องใส่ชื่อคอร์ต';
  end if;

  update courts set name = v_name where id = p_court_id;

  update matches
  set court_name = v_name
  where court_id = p_court_id and ended_at is null;
end;
$$;

grant execute on function rename_court(uuid, text) to authenticated;
