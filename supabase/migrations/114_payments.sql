-- 114: เก็บเงิน — ติ๊กว่าใครจ่ายแล้ว, ยอดค้างจ่ายข้ามวัน, พร้อมเพย์ของก๊วน
--
-- players.paid_at               null = ยังไม่จ่าย
-- clubs.promptpay_id / _name    ไว้สร้าง QR พร้อมเพย์ (สมาชิกในก๊วนเห็น)
-- v_club_outstanding            หนึ่งแถวต่อคนต่อวันที่จบแล้วแต่ยังไม่จ่าย
-- v_my_clubs                    + promptpay_id, promptpay_name

alter table players add column if not exists paid_at timestamptz;
alter table clubs add column if not exists promptpay_id text
  check (promptpay_id ~ '^([0-9]{10}|[0-9]{13}|[0-9]{15})$');
alter table clubs add column if not exists promptpay_name text;

create or replace view v_club_outstanding as
select
  s.club_id,
  s.id               as session_id,
  s.play_date,
  p.id               as player_id,
  p.member_id,
  p.name,
  s.final_per_person as amount
from players p
join sessions s on s.id = p.session_id
where s.status = 'done'
  and p.paying
  and p.status <> 'absent'
  and p.paid_at is null
  and s.final_per_person > 0;
alter view v_club_outstanding set (security_invoker = on);

create or replace view v_my_clubs as
select
  c.id,
  c.owner_id,
  c.name,
  c.note,
  c.active,
  c.created_at,
  a.role,
  (c.owner_id = auth.uid()) as is_mine,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'done')    as done_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'planned')   as planned_days,
  (select count(*) from sessions s where s.club_id = c.id and s.status = 'cancelled') as cancelled_days,
  (select count(*) from sessions s where s.club_id = c.id)                            as total_days,
  (select s.id from sessions s where s.club_id = c.id and s.status = 'playing' limit 1) as playing_session_id,
  (select max(s.play_date) from sessions s where s.club_id = c.id and s.status = 'done') as last_played_on,
  (select min(s.play_date) from sessions s
    where s.club_id = c.id and s.status = 'planned' and s.play_date >= current_date) as next_play_date,
  c.show_rating,
  c.promptpay_id,
  c.promptpay_name
from clubs c
join club_access a on a.club_id = c.id and a.user_id = auth.uid();
